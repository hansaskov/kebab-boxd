import { and, asc, between, desc, eq, sql } from "drizzle-orm";
import { authorizedWriteAll, findTargetRestaurants } from "@src/db/authorize";
import { authorsOfReviewsAt, refreshAuthorStats } from "@src/db/cached-stats";
import type { Client } from "@src/db/client";
import { chunks, durableSqliteLimits } from "@src/db/limits";
import { isInCollectionOf } from "@src/db/collections";
import { notify, withdrawDecision } from "@src/db/notifications";
import { cursorList, type Filter, type Seek } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { RestaurantStatus } from "@src/db/schema";
import type { Cluster } from "@src/map/clusters";
import type { Bounds } from "@src/map/coordinates";
import type { ClusterGrid } from "@src/map/viewport";
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

export interface ClusterRestaurant {
	id: number;
	name: string;
	ratingAvg: number;
	city: string | null;
}

// The cell of the grid a location is in. The longitude plus 180 is never negative, so casting it to an integer
// rounds it down.
function cellOf({ columnsPerDegree, rowEdges }: ClusterGrid) {
	const { latitude, longitude } = s.locations;
	return {
		column: sql<number>`cast((${longitude} + 180) * ${columnsPerDegree} as integer)`,
		row: rowEdges.length === 0 ? sql<number>`0` : sql<number>`${sql.join(rowEdges.map((edge) => sql`(${latitude} <= ${edge})`), sql` + `)}`,
	};
}

// The approved restaurants whose location is in the bounds. A query that uses it reads from the locations, cross
// joined with the restaurants, so that SQLite starts from the locations in the bounds, which their index finds, and
// looks up the restaurant of each. It would rather start from the approved restaurants, which reads every one of
// them, wherever it is. The relational queries cannot choose the order SQLite joins in, so these use the core
// query builder.
function approvedIn(bounds: Bounds) {
	return and(
		eq(s.restaurants.locationId, s.locations.id),
		eq(s.restaurants.status, "approved"),
		between(s.locations.latitude, bounds.south, bounds.north),
		between(s.locations.longitude, bounds.west, bounds.east),
	);
}

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

		// The approved restaurants in the bounds, as a Cluster for each cell of the grid that has any. Without a
		// grid, each restaurant is a cluster of its own.
		//
		// The relational queries cannot group rows either. The innermost query finds the cell of each restaurant
		// once, which keeps the values bound to the statement few. Window functions over the restaurants of each
		// cell then give every row the count, average position and bounds of its cluster, and rank the rows, so
		// that the first row in the ranking stands for its cluster.
		async listClusters(bounds: Bounds, grid: ClusterGrid | undefined): Promise<Cluster<ClusterRestaurant>[]> {
			const cell = grid ? cellOf(grid) : { column: sql<number>`${s.restaurants.id}`, row: sql<number>`0` };
			const located = client
				.select({
					id: s.restaurants.id,
					name: s.restaurants.name,
					ratingAvg: s.restaurants.ratingAvg,
					city: s.locations.city,
					latitude: s.locations.latitude,
					longitude: s.locations.longitude,
					column: cell.column.as("cell_column"),
					row: cell.row.as("cell_row"),
				})
				.from(s.locations)
				.crossJoin(s.restaurants)
				.where(approvedIn(bounds))
				.as("located");

			const ofCluster = sql`over (partition by ${located.column}, ${located.row})`;
			const ranked = client
				.select({
					id: located.id,
					name: located.name,
					ratingAvg: located.ratingAvg,
					city: located.city,
					count: sql<number>`count(*) ${ofCluster}`.as("count"),
					latitude: sql<number>`avg(${located.latitude}) ${ofCluster}`.as("average_latitude"),
					longitude: sql<number>`avg(${located.longitude}) ${ofCluster}`.as("average_longitude"),
					north: sql<number>`max(${located.latitude}) ${ofCluster}`.as("north"),
					south: sql<number>`min(${located.latitude}) ${ofCluster}`.as("south"),
					east: sql<number>`max(${located.longitude}) ${ofCluster}`.as("east"),
					west: sql<number>`min(${located.longitude}) ${ofCluster}`.as("west"),
					rank: sql<number>`row_number() over (partition by ${located.column}, ${located.row} order by ${located.ratingAvg} desc, ${located.id})`.as(
						"rank",
					),
				})
				.from(located)
				.as("ranked");

			const rows = await client.select().from(ranked).where(eq(ranked.rank, 1));
			return rows.map(({ id, name, ratingAvg, city, count, latitude, longitude, north, south, east, west }) => ({
				count,
				center: { latitude, longitude },
				bounds: { north, south, east, west },
				best: { id, name, ratingAvg, city },
			}));
		},

		// The best-rated approved restaurant in the bounds, the one with more reviews first when two are rated the
		// same, if there is one.
		async findBestRatedIn(bounds: Bounds): Promise<{ id: number } | undefined> {
			const [best] = await client
				.select({ id: s.restaurants.id })
				.from(s.locations)
				.crossJoin(s.restaurants)
				.where(approvedIn(bounds))
				.orderBy(desc(s.restaurants.ratingAvg), desc(s.restaurants.reviewCount), asc(s.restaurants.id))
				.limit(1);
			return best;
		},

		// An approved restaurant, chosen by a fraction from 0 up to 1, such as one from Math.random(). The fraction
		// picks an id between the first and the last approved restaurant, and the approved restaurant with that id
		// or the next one is chosen. So it reads three rows, however many restaurants there are. A restaurant
		// after ids that are not approved is chosen a little more often than the others.
		async pickApproved(fraction: number): Promise<{ id: number } | undefined> {
			const columns = { id: true } as const;
			const [first, last] = await Promise.all([
				client.query.restaurants.findFirst({ columns, where: { status: "approved" }, orderBy: { id: "asc" } }),
				client.query.restaurants.findFirst({ columns, where: { status: "approved" }, orderBy: { id: "desc" } }),
			]);
			if (!first || !last) return undefined;
			const share = Math.min(Math.max(fraction, 0), 1 - Number.EPSILON);
			const from = first.id + Math.floor(share * (last.id - first.id + 1));
			return client.query.restaurants.findFirst({ columns, where: { status: "approved", id: { gte: from } }, orderBy: { id: "asc" } });
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
				const changed = restaurants.filter((restaurant) => restaurant.status !== status);
				for (const restaurant of changed) {
					tx.update(s.restaurants).set({ status }).where(eq(s.restaurants.id, restaurant.id)).run();
					// The decision replaces the earlier one with a new notification, so the suggester sees it as unread.
					withdrawDecision(tx, restaurant.id);
					if (restaurant.suggestedBy !== null && restaurant.suggestedBy !== actorId) {
						notify(tx, { kind: `suggestion-${status}`, recipientId: restaurant.suggestedBy, restaurantId: restaurant.id });
					}
				}
				// The reviews of a restaurant are public only while it is approved.
				for (const chunk of chunks(changed.map((restaurant) => restaurant.id), durableSqliteLimits.variableNumber / 2)) {
					refreshAuthorStats(tx, authorsOfReviewsAt(tx, chunk));
				}
				return { decided: restaurants.length };
			});
		},
	};
}
