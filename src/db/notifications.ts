import { and, eq, inArray, isNull, sql, type SQLWrapper } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { cursorList, type Seek } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { NotificationKind, SuggestionDecision, User } from "@src/db/schema";
import { isVisibleNotification } from "@src/db/visibility";
import type { Page, PageRequest } from "@src/pagination";

export type NotificationEvent =
	| { kind: "follow"; recipientId: number; actorId: number }
	| { kind: "like"; recipientId: number; actorId: number; reviewId: number }
	| { kind: SuggestionDecision; recipientId: number; restaurantId: number };

export type NotificationPreferences = Pick<User, "followNotifications" | "likeNotifications" | "suggestionNotifications">;

const preferenceOf = {
	follow: "followNotifications",
	like: "likeNotifications",
	"suggestion-approved": "suggestionNotifications",
	"suggestion-rejected": "suggestionNotifications",
} as const satisfies Record<NotificationKind, keyof NotificationPreferences>;

const suggestionDecisions = ["suggestion-approved", "suggestion-rejected"] as const satisfies SuggestionDecision[];

// Drizzle types a value in an insert from a select only when it has a name.
function aliased(name: string, value: unknown) {
	return sql`${value}`.as(name);
}

// Sending the same event twice leaves one notification. The statement inserts nothing when the recipient has
// turned the kind off. An insert from a select sets no defaults, so the times are set here.
export function notify(tx: Transaction, event: NotificationEvent) {
	const { actorId = null, reviewId = null, restaurantId = null } = event as Partial<Record<"actorId" | "reviewId" | "restaurantId", number>>;
	const now = sql`unixepoch()`;
	tx.insert(s.notifications)
		.select((qb) =>
			qb
				.select({
					recipientId: s.users.id,
					kind: aliased("kind", event.kind),
					actorId: aliased("actor_id", actorId),
					reviewId: aliased("review_id", reviewId),
					restaurantId: aliased("restaurant_id", restaurantId),
					createdAt: now.as("created_at"),
					updatedAt: now.as("updated_at"),
				})
				.from(s.users)
				.where(and(eq(s.users.id, event.recipientId), eq(s.users[preferenceOf[event.kind]], true))),
		)
		.onConflictDoNothing()
		.run();
}

// Undoing the event removes its notification.
export function withdraw(tx: Transaction, event: Extract<NotificationEvent, { actorId: number }>) {
	const n = s.notifications;
	const sameTarget = event.kind === "follow" ? eq(n.recipientId, event.recipientId) : eq(n.reviewId, event.reviewId);
	tx.delete(n).where(and(eq(n.kind, event.kind), eq(n.actorId, event.actorId), sameTarget)).run();
}

// A new decision makes the earlier one on the same restaurant untrue, whoever decided and whether or not
// the suggester wants to hear about it.
export function withdrawDecision(tx: Transaction, restaurantId: number) {
	const n = s.notifications;
	tx.delete(n).where(and(inArray(n.kind, suggestionDecisions), eq(n.restaurantId, restaurantId))).run();
}

// The notifications the recipient has not read and can see, as a condition on the notifications table.
export function isUnreadOf(recipientId: number | SQLWrapper) {
	const n = s.notifications;
	return and(eq(n.recipientId, recipientId), isNull(n.readAt), isVisibleNotification(n));
}

const pages = cursorList("notifications", ["createdAt", "id"], "desc");

const notificationRow = {
	columns: { id: true, kind: true, readAt: true, createdAt: true },
	with: {
		actor: { columns: { username: true, fullname: true }, with: { profilePicture: { columns: { url: true } } } },
		review: { columns: { id: true }, with: { restaurant: { columns: { name: true } } } },
		restaurant: { columns: { id: true, name: true } },
	},
} as const;

type Row = Awaited<ReturnType<ReturnType<typeof listRows>>>[number];
type Present<Key extends "actor" | "review" | "restaurant"> = NonNullable<Row[Key]>;

export type Notification = Pick<Row, "id" | "createdAt"> & { isRead: boolean } & (
		| { kind: "follow"; actor: Present<"actor"> }
		| { kind: "like"; actor: Present<"actor">; review: Present<"review"> }
		| { kind: SuggestionDecision; restaurant: Present<"restaurant"> }
	);

function listRows(client: Client, recipientId: number) {
	return (seek: Seek<"notifications">) =>
		client.query.notifications.findMany({
			...notificationRow,
			...seek({ recipientId, RAW: (notification) => isVisibleNotification(notification) }),
		});
}

function present<T>(value: T | null, row: Row): T {
	if (value === null) throw new Error(`Notification ${row.id} of kind ${row.kind} lacks what its kind needs.`);
	return value;
}

// The database checks that each kind has the columns it needs, so a missing one is a bug.
function toNotification(row: Row): Notification {
	const common = { id: row.id, createdAt: row.createdAt, isRead: row.readAt !== null };
	switch (row.kind) {
		case "follow":
			return { ...common, kind: row.kind, actor: present(row.actor, row) };
		case "like":
			return { ...common, kind: row.kind, actor: present(row.actor, row), review: present(row.review, row) };
		case "suggestion-approved":
		case "suggestion-rejected":
			return { ...common, kind: row.kind, restaurant: present(row.restaurant, row) };
	}
}

export function createNotifications(client: Client) {
	return {
		// Shows the recipient a page of their notifications, each as unread or read as it was before, and marks
		// the unread ones read, since the recipient has now seen them. Tells how many stay unread: those on
		// other pages, and those that came after the page was read.
		async show(recipientId: number, page: PageRequest): Promise<{ page: Page<Notification>; unreadCount: number }> {
			const rows = await pages(page, listRows(client, recipientId));
			const shownUnread = rows.items.filter((row) => row.readAt === null).map((row) => row.id);
			if (shownUnread.length > 0) {
				await client
					.update(s.notifications)
					.set({ readAt: new Date() })
					.where(and(isUnreadOf(recipientId), inArray(s.notifications.id, shownUnread)));
			}
			return {
				page: { ...rows, items: rows.items.map(toNotification) },
				unreadCount: await client.$count(s.notifications, isUnreadOf(recipientId)),
			};
		},
	};
}
