import { and, eq, sql } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { authorizedWrite } from "@src/db/mutations/authorized-write";
import * as s from "@src/db/schema";
import type { NewLocation } from "@src/db/schema";
import { boundsAround } from "@src/map/coordinates";

// Two suggestions with the same name this close to each other are taken to be the same restaurant.
const duplicateDistanceMeters = 150;

export type Collection = "favorites" | "bucketList";

const collections = { favorites: s.favorites, bucketList: s.bucketList } as const;

export interface Suggestion {
	name: string;
	location: Omit<NewLocation, "id" | "createdAt" | "updatedAt">;
}

export type SuggestResult =
	| { status: "suggested"; id: number }
	| { status: "duplicate"; id: number; duplicateStatus: "approved" | "pending" };

export function findTargetRestaurant(tx: Transaction, id: number) {
	return tx.query.restaurants.findFirst({ columns: { status: true, suggestedBy: true }, where: { id } }).sync();
}

function findDuplicate(tx: Transaction, { name, location }: Suggestion) {
	const { north, south, east, west } = boundsAround(location, duplicateDistanceMeters);
	return tx.query.restaurants
		.findFirst({
			columns: { id: true, status: true },
			where: {
				status: { in: ["approved", "pending"] },
				RAW: (restaurant) => sql`lower(${restaurant.name}) = lower(${name})`,
				location: { latitude: { gte: south, lte: north }, longitude: { gte: west, lte: east } },
			},
		})
		.sync();
}

export function createRestaurantMutations(client: Client) {
	return {
		// A rejected restaurant may be suggested again, for example with a corrected address.
		async suggest(userId: number, suggestion: Suggestion): Promise<SuggestResult> {
			return client.transaction(
				(tx): SuggestResult => {
					const duplicate = findDuplicate(tx, suggestion);
					if (duplicate?.status === "approved" || duplicate?.status === "pending") {
						return { status: "duplicate", id: duplicate.id, duplicateStatus: duplicate.status };
					}

					const location = tx.insert(s.locations).values(suggestion.location).returning({ id: s.locations.id }).get();
					const restaurant = tx
						.insert(s.restaurants)
						.values({ name: suggestion.name, locationId: location.id, suggestedBy: userId, status: "pending" })
						.returning({ id: s.restaurants.id })
						.get();
					return { status: "suggested", id: restaurant.id };
				},
				{ behavior: "immediate" },
			);
		},

		async setStatus(actorId: number, id: number, status: "approved" | "rejected") {
			return authorizedWrite(client, actorId, "restaurant:moderate", (tx) => findTargetRestaurant(tx, id), (tx) => {
				tx.update(s.restaurants).set({ status }).where(eq(s.restaurants.id, id)).run();
				return "updated" as const;
			});
		},

		async collect(collection: Collection, userId: number, restaurantId: number) {
			const table = collections[collection];
			return authorizedWrite(client, userId, "restaurant:collect", (tx) => findTargetRestaurant(tx, restaurantId), (tx) => {
				tx.insert(table).values({ userId, restaurantId }).onConflictDoNothing().run();
				return "updated" as const;
			});
		},

		// Removing needs no permission: the row belongs to the user, whatever became of the restaurant.
		async uncollect(collection: Collection, userId: number, restaurantId: number) {
			const table = collections[collection];
			await client.delete(table).where(and(eq(table.userId, userId), eq(table.restaurantId, restaurantId)));
		},
	};
}
