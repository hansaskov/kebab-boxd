import type { Client } from "@src/db/client";
import { visibleNotification } from "@src/db/filters";
import { cursorList, type Seek } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { SuggestionDecision } from "@src/db/schema";
import type { Page, PageRequest } from "@src/pagination";

const pages = cursorList(s.notifications, ["createdAt", "id"], "desc");

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
	return (seek: Seek<typeof s.notifications>) =>
		client.query.notifications.findMany({
			...notificationRow,
			where: { AND: [{ recipientId }, visibleNotification, seek.where] },
			orderBy: seek.orderBy,
			limit: seek.limit,
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

export function createNotificationQueries(client: Client) {
	return {
		async list(recipientId: number, page: PageRequest): Promise<Page<Notification>> {
			const rows = await pages(page, listRows(client, recipientId));
			return { ...rows, items: rows.items.map(toNotification) };
		},

		// The newest notification the user has not read, up to which "mark all as read" marks.
		async findNewestUnreadId(recipientId: number) {
			const notification = await client.query.notifications.findFirst({
				columns: { id: true },
				where: { AND: [{ recipientId, readAt: { isNull: true } }, visibleNotification] },
				orderBy: { id: "desc" },
			});
			return notification?.id;
		},
	};
}
