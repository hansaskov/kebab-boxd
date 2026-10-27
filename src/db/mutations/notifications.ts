import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { isVisibleNotification } from "@src/db/filters";
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

function wantsNotification(tx: Transaction, { kind, recipientId }: NotificationEvent) {
	const recipient = tx.query.users
		.findFirst({
			columns: { followNotifications: true, likeNotifications: true, suggestionNotifications: true },
			where: { id: recipientId },
		})
		.sync();
	return recipient?.[preferenceOf[kind]] === true;
}

// Sending the same event twice leaves one notification.
export function notify(tx: Transaction, event: NotificationEvent) {
	if (!wantsNotification(tx, event)) return;
	tx.insert(s.notifications).values(event).onConflictDoNothing().run();
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
				.where(and(eq(n.recipientId, recipientId), isNull(n.readAt), lte(n.id, upToId), isVisibleNotification(n)));
		},
	};
}
