import { and, eq, exists, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import { authorizedWrite, findTargetRestaurant } from "@src/db/authorize";
import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import { isApprovedRestaurant, ofViewer } from "@src/db/visibility";
import type { PageRequest } from "@src/pagination";

// The Favorites and the BucketList of a user. They are alike today but kept apart, as CONTEXT.md explains.
export type Collection = "favorites" | "bucketList";

const tables = { favorites: s.favorites, bucketList: s.bucketList } as const;

const favoritePages = cursorList("favorites", ["createdAt", "restaurantId"], "desc");
const bucketListPages = cursorList("bucketList", ["createdAt", "restaurantId"], "desc");

const qb = new QueryBuilder();

// Whether the restaurant is in the collection of the viewer, as an extra of a query on restaurants. A Visitor has none.
export function isInCollectionOf(collection: Collection, viewerId: number | null) {
	const table = tables[collection];
	return (restaurant: typeof s.restaurants) =>
		ofViewer(viewerId, (id) =>
			exists(
				qb
					.select({ row: sql`1` })
					.from(table)
					.where(and(eq(table.restaurantId, restaurant.id), eq(table.userId, id))),
			),
		);
}

// How many approved restaurants are in the collection of the user, as an extra of a query on users.
export function collectionCount(client: Client, collection: Collection) {
	const table = tables[collection];
	return (user: typeof s.users) => client.$count(table, and(eq(table.userId, user.id), isApprovedRestaurant(table.restaurantId)));
}

const listedRestaurant = {
	columns: { restaurantId: true, createdAt: true },
	with: {
		restaurant: {
			columns: { id: true, name: true, ratingAvg: true },
			with: { location: { columns: { city: true } } },
		},
	},
} as const;

export function createCollections(client: Client) {
	return {
		async add(userId: number, restaurantId: number, collection: Collection) {
			const table = tables[collection];
			return authorizedWrite(client, userId, "restaurant:collect", (tx) => findTargetRestaurant(tx, restaurantId), (tx) => {
				tx.insert(table).values({ userId, restaurantId }).onConflictDoNothing().run();
				return "updated" as const;
			});
		},

		// Needs no permission: the row belongs to the user, whatever became of the restaurant.
		async remove(userId: number, restaurantId: number, collection: Collection) {
			const table = tables[collection];
			await client.delete(table).where(and(eq(table.userId, userId), eq(table.restaurantId, restaurantId)));
		},

		// The approved restaurants in the collection, the latest added first.
		async list(userId: number, collection: Collection, page: PageRequest) {
			const rows =
				collection === "favorites"
					? await favoritePages(page, (seek) =>
							client.query.favorites.findMany({ ...listedRestaurant, ...seek({ userId, restaurant: { status: "approved" } }) }),
						)
					: await bucketListPages(page, (seek) =>
							client.query.bucketList.findMany({ ...listedRestaurant, ...seek({ userId, restaurant: { status: "approved" } }) }),
						);
			return { ...rows, items: rows.items.map((row) => row.restaurant) };
		},
	};
}
