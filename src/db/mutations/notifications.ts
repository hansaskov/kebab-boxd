import { and, eq, exists, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import * as s from "@src/db/schema";
import type { NotificationKind, SuggestionDecision, User } from "@src/db/schema";

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

export function createNotificationMutations(client: Client) {
	return {
		// Marks no notification newer than the ones the user saw, and none that is hidden from them.
		async markAllRead(recipientId: number, upToId: number) {
			const n = s.notifications;
			await client
				.update(n)
				.set({ readAt: new Date() })
				.where(
					and(
						eq(n.recipientId, recipientId),
						isNull(n.readAt),
						lte(n.id, upToId),
						or(
							isNull(n.actorId),
							exists(
								client
									.select({ row: sql`1` })
									.from(s.users)
									.where(and(eq(s.users.id, n.actorId), isNull(s.users.bannedAt))),
							),
						),
					),
				);
		},
	};
}
