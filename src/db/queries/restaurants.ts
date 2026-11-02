import { and, eq, exists, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList, type Filter, type Seek } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { RestaurantStatus } from "@src/db/schema";
import { longitudeScale, type Bounds, type Coordinates } from "@src/map/coordinates";
import type { PageRequest } from "@src/pagination";

export const restaurantSorts = ["top-rated", "popular", "newest"] as const;
export type RestaurantSort = (typeof restaurantSorts)[number];

export interface RestaurantListCriteria {
	search: string;
	sort: RestaurantSort;
}

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

function isInCollection(client: Client, table: typeof s.favorites | typeof s.bucketList, viewerId: number) {
	return (restaurant: typeof s.restaurants) =>
		exists(
			client
				.select({ row: sql`1` })
				.from(table)
				.where(and(eq(table.restaurantId, restaurant.id), eq(table.userId, viewerId))),
		).mapWith(Boolean);
}

// Orders by the squared distance in degrees, with longitude scaled to the latitude. Over the distances a map
// shows, this is the order of the real distance, and SQLite computes it without trigonometric functions.
function byDistanceFrom(center: Coordinates) {
	const scale = longitudeScale(center.latitude) ** 2;
	return (location: typeof s.locations) =>
		sql`(${location.latitude} - ${center.latitude}) * (${location.latitude} - ${center.latitude})
			+ (${location.longitude} - ${center.longitude}) * (${location.longitude} - ${center.longitude}) * ${scale}`;
}

const pinned = {
	columns: { latitude: true, longitude: true, city: true },
	with: { restaurant: { columns: { id: true, name: true, ratingAvg: true, reviewCount: true } } },
} as const;

type PinnedLocation = Omit<Pin, "restaurant"> & { restaurant: Pin["restaurant"] | null };

export interface Pin {
	latitude: number;
	longitude: number;
	city: string | null;
	restaurant: { id: number; name: string; ratingAvg: number; reviewCount: number };
}

function withRestaurant(locations: PinnedLocation[]): Pin[] {
	return locations.flatMap(({ restaurant, ...location }) => (restaurant ? [{ ...location, restaurant }] : []));
}

export function createRestaurantQueries(client: Client) {
	return {
		async list({ search, sort }: RestaurantListCriteria, page: PageRequest) {
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

		async findById(id: number, viewerId: number) {
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
					isFavoriteOfViewer: isInCollection(client, s.favorites, viewerId),
					isInBucketListOfViewer: isInCollection(client, s.bucketList, viewerId),
				},
				where: { id },
			});
		},

		// The restaurants nearest to the center, within the bounds when there are any.
		async listNearest(center: Coordinates, limit: number, bounds?: Bounds) {
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
			return withRestaurant(locations);
		},

		// The queue of suggestions is worked through oldest first; decided suggestions show the latest first.
		async listByStatus(status: RestaurantStatus, page: PageRequest) {
			const read = (seek: Seek<"restaurants">) =>
				client.query.restaurants.findMany({
					...summary,
					with: { ...summary.with, suggester: { columns: { username: true, fullname: true } } },
					...seek({ status }),
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

		async countByStatus() {
			const counts = await client.query.restaurants.findFirst({
				columns: {},
				extras: {
					approved: client.$count(s.restaurants, eq(s.restaurants.status, "approved")),
					pending: client.$count(s.restaurants, eq(s.restaurants.status, "pending")),
					rejected: client.$count(s.restaurants, eq(s.restaurants.status, "rejected")),
				},
			});
			// Without a restaurant there is no row to read the counts from, and every count is 0.
			return counts ?? { approved: 0, pending: 0, rejected: 0 };
		},
	};
}

