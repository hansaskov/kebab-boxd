import { and, eq, exists, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { approvedRestaurant, containsText, type Filter } from "@src/db/filters";
import { cursorList, type Seek } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { RestaurantStatus } from "@src/db/schema";
import { asBoolean, countRows } from "@src/db/subqueries";
import { longitudeScale, type Bounds, type Coordinates } from "@src/map/coordinates";
import type { PageItem, PageRequest } from "@src/pagination";

export const restaurantSorts = ["top-rated", "popular", "newest"] as const;
export type RestaurantSort = (typeof restaurantSorts)[number];

export interface RestaurantListCriteria {
	search: string;
	sort: RestaurantSort;
}

const topRatedPages = cursorList(s.restaurants, ["ratingAvg", "id"], "desc");
const popularPages = cursorList(s.restaurants, ["reviewCount", "id"], "desc");
const newestPages = cursorList(s.restaurants, ["id"], "desc");
const oldestPages = cursorList(s.restaurants, ["id"], "asc");

const summary = {
	columns: { id: true, name: true, status: true, ratingAvg: true, reviewCount: true, createdAt: true },
	with: { location: { columns: { addressLine1: true, city: true, country: true } } },
} as const;

function matching(search: string): Filter<"restaurants"> {
	if (!search) return {};
	return {
		OR: [
			{ RAW: (restaurant) => containsText(restaurant.name, search) },
			{ location: { RAW: (location) => containsText(location.city, search) } },
		],
	};
}

function isInCollection(client: Client, table: typeof s.favorites | typeof s.bucketList, viewerId: number) {
	return (restaurant: typeof s.restaurants) =>
		asBoolean(
			exists(
				client
					.select({ row: sql`1` })
					.from(table)
					.where(and(eq(table.restaurantId, restaurant.id), eq(table.userId, viewerId))),
			),
		);
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
			const read = (seek: Seek<typeof s.restaurants>) =>
				client.query.restaurants.findMany({
					...summary,
					where: { AND: [approvedRestaurant, matching(search), seek.where] },
					orderBy: seek.orderBy,
					limit: seek.limit,
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

		async listInBounds({ north, south, east, west }: Bounds, center: Coordinates, limit: number) {
			const locations = await client.query.locations.findMany({
				...pinned,
				where: {
					latitude: { gte: south, lte: north },
					longitude: { gte: west, lte: east },
					restaurant: approvedRestaurant,
				},
				orderBy: byDistanceFrom(center),
				limit,
			});
			return withRestaurant(locations);
		},

		async listNearest(center: Coordinates, limit: number) {
			const locations = await client.query.locations.findMany({
				...pinned,
				where: { restaurant: approvedRestaurant },
				orderBy: byDistanceFrom(center),
				limit,
			});
			return withRestaurant(locations);
		},

		// The queue of suggestions is worked through oldest first; decided suggestions show the latest first.
		async listByStatus(status: RestaurantStatus, page: PageRequest) {
			const read = (seek: Seek<typeof s.restaurants>) =>
				client.query.restaurants.findMany({
					...summary,
					with: { ...summary.with, suggester: { columns: { username: true, fullname: true } } },
					where: { AND: [{ status }, seek.where] },
					orderBy: seek.orderBy,
					limit: seek.limit,
				});
			return status === "pending" ? oldestPages(page, read) : newestPages(page, read);
		},

		async listSuggestedBy(userId: number, page: PageRequest) {
			return newestPages(page, (seek) =>
				client.query.restaurants.findMany({
					...summary,
					where: { AND: [{ suggestedBy: userId }, seek.where] },
					orderBy: seek.orderBy,
					limit: seek.limit,
				}),
			);
		},

		async countByStatus(): Promise<Record<RestaurantStatus, number>> {
			const [approved, pending, rejected] = await Promise.all([
				countRows(client, "restaurants", { status: "approved" }),
				countRows(client, "restaurants", { status: "pending" }),
				countRows(client, "restaurants", { status: "rejected" }),
			]);
			return { approved, pending, rejected };
		},
	};
}

export type RestaurantSummary = PageItem<Awaited<ReturnType<ReturnType<typeof createRestaurantQueries>["list"]>>>;
