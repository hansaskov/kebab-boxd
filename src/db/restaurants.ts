import { and, eq, sql } from "drizzle-orm";
import { authorizedWriteAll, findTargetRestaurants } from "@src/db/authorize";
import type { Client } from "@src/db/client";
import { isInCollectionOf } from "@src/db/collections";
import { notify, withdrawDecision } from "@src/db/notifications";
import { cursorList, type Filter, type Seek } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { RestaurantStatus } from "@src/db/schema";
import { longitudeScale, type Bounds, type Coordinates } from "@src/map/coordinates";
import type { PageRequest } from "@src/pagination";

export const restaurantSorts = ["top-rated", "popular", "newest"] as const;
export type RestaurantSort = (typeof restaurantSorts)[number];

const topRatedPages = cursorList("restaurants", ["ratingAvg", "id"], "desc");
const popularPages = cursorList("restaurants", ["reviewCount", "id"], "desc");
const newestPages = cursorList("restaurants", ["id"], "desc");
const oldestPages = cursorList("restaurants", ["id"], "asc");

const summary = {
	columns: { id: true, name: true, status: true, ratingAvg: true, reviewCount: true, createdAt: true },
	with: { location: { columns: { addressLine1: true, city: true, country: true } } },
} as const;

function matching(search: string): Filter<"restaurants"> {
	if (!search) return {};
	return {
		OR: [
			{ RAW: (restaurant) => sql`instr(lower(${restaurant.name}), lower(${search})) > 0` },
			{ location: { RAW: (location) => sql`instr(lower(${location.city}), lower(${search})) > 0` } },
		],
	};
}

// Orders by the squared distance in degrees, with longitude scaled to the latitude. Over the distances a map
// shows, this is the order of the real distance, and SQLite computes it without trigonometric functions.
function byDistanceFrom(center: Coordinates) {
	const scale = longitudeScale(center.latitude) ** 2;
	return (location: typeof s.locations) =>
		sql`(${location.latitude} - ${center.latitude}) * (${location.latitude} - ${center.latitude})
			+ (${location.longitude} - ${center.longitude}) * (${location.longitude} - ${center.longitude}) * ${scale}`;
}

export interface Pin {
	latitude: number;
	longitude: number;
	city: string | null;
	restaurant: { id: number; name: string; ratingAvg: number; reviewCount: number };
}

const pinned = {
	columns: { latitude: true, longitude: true, city: true },
	with: { restaurant: { columns: { id: true, name: true, ratingAvg: true, reviewCount: true } } },
} as const;

export function createRestaurants(client: Client) {
	return {
		// The approved restaurants whose name or city contains the search.
		async list(search: string, sort: RestaurantSort, page: PageRequest) {
			const read = (seek: Seek<"restaurants">) =>
				client.query.restaurants.findMany({
					...summary,
					...seek({ AND: [{ status: "approved" }, matching(search)] }),
				});
			switch (sort) {
				case "top-rated":
					return topRatedPages(page, read);
				case "popular":
					return popularPages(page, read);
				case "newest":
					return newestPages(page, read);
			}
		},

		async findById(id: number, viewerId: number | null) {
			return client.query.restaurants.findFirst({
				columns: { id: true, name: true, status: true, suggestedBy: true, ratingAvg: true, reviewCount: true, createdAt: true },
				with: {
					location: {
						columns: {
							addressLine1: true,
							addressLine2: true,
							postalCode: true,
							city: true,
							region: true,
							country: true,
							latitude: true,
							longitude: true,
						},
					},
					suggester: { columns: { username: true, fullname: true } },
				},
				extras: {
					isFavoriteOfViewer: isInCollectionOf("favorites", viewerId),
					isInBucketListOfViewer: isInCollectionOf("bucketList", viewerId),
				},
				where: { id },
			});
		},

		// The approved restaurants nearest to the center, within the bounds when there are any.
		async listNearest(center: Coordinates, limit: number, bounds?: Bounds): Promise<Pin[]> {
			const locations = await client.query.locations.findMany({
				...pinned,
				where: {
					...(bounds && {
						latitude: { gte: bounds.south, lte: bounds.north },
						longitude: { gte: bounds.west, lte: bounds.east },
					}),
					restaurant: { status: "approved" },
				},
				orderBy: byDistanceFrom(center),
				limit,
			});
			// The filter on the restaurant guarantees one, which the type of the relation cannot tell.
			return locations.flatMap(({ restaurant, ...location }) => (restaurant ? [{ ...location, restaurant }] : []));
		},

		// The queue of suggestions is worked through oldest first; decided suggestions show the latest first.
		// With a CitySearch, only the restaurants it found.
		async listByStatus(status: RestaurantStatus, page: PageRequest, citySearchId: number | undefined = undefined) {
			const read = (seek: Seek<"restaurants">) =>
				client.query.restaurants.findMany({
					columns: { ...summary.columns, googleMapsId: true, osmId: true },
					with: { ...summary.with, suggester: { columns: { username: true, fullname: true } } },
					...seek({ status, ...(citySearchId !== undefined && { citySearchId }) }),
				});
			return status === "pending" ? oldestPages(page, read) : newestPages(page, read);
		},

		async listSuggestedBy(userId: number, page: PageRequest) {
			return newestPages(page, (seek) =>
				client.query.restaurants.findMany({
					...summary,
					...seek({ suggestedBy: userId }),
				}),
			);
		},

		// With a CitySearch, only the restaurants it found.
		async countByStatus(citySearchId: number | undefined = undefined): Promise<Record<RestaurantStatus, number>> {
			const found = citySearchId === undefined ? undefined : eq(s.restaurants.citySearchId, citySearchId);
			const count = (status: RestaurantStatus) => client.$count(s.restaurants, and(eq(s.restaurants.status, status), found));
			const counts = await client.query.restaurants.findFirst({
				columns: {},
				extras: { approved: count("approved"), pending: count("pending"), rejected: count("rejected") },
			});
			// Without a restaurant there is no row to read the counts from, and every count is 0.
			return counts ?? { approved: 0, pending: 0, rejected: 0 };
		},

		// Approves or rejects restaurants, and tells each suggester. Decides all of them or, when one cannot be
		// decided, none.
		async decide(actorId: number, ids: number[], status: "approved" | "rejected") {
			const unique = [...new Set(ids)];
			return authorizedWriteAll(client, actorId, "restaurant:moderate", (tx) => findTargetRestaurants(tx, unique), (tx, restaurants) => {
				for (const restaurant of restaurants) {
					if (restaurant.status === status) continue;
					tx.update(s.restaurants).set({ status }).where(eq(s.restaurants.id, restaurant.id)).run();
					// The decision replaces the earlier one with a new notification, so the suggester sees it as unread.
					withdrawDecision(tx, restaurant.id);
					if (restaurant.suggestedBy !== null && restaurant.suggestedBy !== actorId) {
						notify(tx, { kind: `suggestion-${status}`, recipientId: restaurant.suggestedBy, restaurantId: restaurant.id });
					}
				}
				return { decided: restaurants.length };
			});
		},
	};
}
