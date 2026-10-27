import { and, eq } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { authorizedWrite } from "@src/db/mutations/authorize";
import { notify, withdrawDecision } from "@src/db/mutations/notifications";
import * as s from "@src/db/schema";

export type Collection = "favorites" | "bucketList";

const collections = { favorites: s.favorites, bucketList: s.bucketList } as const;

export function findTargetRestaurant(tx: Transaction, id: number) {
	return tx.query.restaurants.findFirst({ columns: { status: true, suggestedBy: true }, where: { id } }).sync();
}

export function createRestaurantMutations(client: Client) {
	return {
		async setStatus(actorId: number, id: number, status: "approved" | "rejected") {
			return authorizedWrite(client, actorId, "restaurant:moderate", (tx) => findTargetRestaurant(tx, id), (tx, restaurant) => {
				if (restaurant.status === status) return "updated" as const;
				tx.update(s.restaurants).set({ status }).where(eq(s.restaurants.id, id)).run();
				// The decision replaces the earlier one with a new notification, which a "mark all as read" sent
				// from a page that showed the earlier one does not mark.
				withdrawDecision(tx, id);
				if (restaurant.suggestedBy !== null && restaurant.suggestedBy !== actorId) {
					notify(tx, { kind: `suggestion-${status}`, recipientId: restaurant.suggestedBy, restaurantId: id });
				}
				return "updated" as const;
			});
		},

		async collect(userId: number, restaurantId: number, collection: Collection) {
			const table = collections[collection];
			return authorizedWrite(client, userId, "restaurant:collect", (tx) => findTargetRestaurant(tx, restaurantId), (tx) => {
				tx.insert(table).values({ userId, restaurantId }).onConflictDoNothing().run();
				return "updated" as const;
			});
		},

		// Removing needs no permission: the row belongs to the user, whatever became of the restaurant.
		async uncollect(userId: number, restaurantId: number, collection: Collection) {
			const table = collections[collection];
			await client.delete(table).where(and(eq(table.userId, userId), eq(table.restaurantId, restaurantId)));
		},
	};
}
