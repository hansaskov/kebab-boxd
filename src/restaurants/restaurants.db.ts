import { and, asc, between, desc, eq, sql } from "drizzle-orm";
import type { RestaurantPermission } from "@src/auth/permissions";
import { authorizedRead, authorizedWriteAll, findTargetRestaurants } from "@src/db/authorize";
import { authorsOfReviewsAt, refreshAuthorStats } from "@src/db/cached-stats";
import type { Client } from "@src/db/client";
import { chunks, durableSqliteLimits } from "@src/db/limits";
import { isInCollectionOf } from "@src/restaurants/collections.db";
import { notify, withdrawDecision } from "@src/notifications/notifications.db";
import { cursorList, type Filter, type Seek } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { RestaurantStatus } from "@src/db/schema";
import type { RestaurantSort } from "@src/restaurants/restaurants";
import { chooseCity } from "@src/cities/cities.db";
import { clustersOn, type Cluster } from "@src/map/clusters";
import { cityBounds, cityView, exploreView, exploreViewport, exploreCityLimit } from "@src/map/explore";
import type { Bounds } from "@src/map/coordinates";
import type { ClusterGrid, MapView } from "@src/map/viewport";
import type { PageRequest } from "@src/pagination";

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

export interface ExploreRequest {
	search: string;
	cityId: number | undefined;
	requested: MapView | undefined;
	isVisitor: boolean;
}

export interface ClusterRestaurant {
	id: number;
	name: string;
	ratingAvg: number;
	city: string | null;
}

function cellOf({ columnsPerDegree, rowEdges }: ClusterGrid) {
	const { latitude, longitude } = s.locations;
	return {
		column: sql<number>`cast((${longitude} + 180) * ${columnsPerDegree} as integer)`,
		row: rowEdges.length === 0 ? sql<number>`0` : sql<number>`${sql.join(rowEdges.map((edge) => sql`(${latitude} <= ${edge})`), sql` + `)}`,
	};
}

function approvedIn(bounds: Bounds) {
	return and(
		eq(s.restaurants.locationId, s.locations.id),
		eq(s.restaurants.status, "approved"),
		between(s.locations.latitude, bounds.south, bounds.north),
		between(s.locations.longitude, bounds.west, bounds.east),
	);
}

export function createRestaurants(client: Client) {
	const listClusters = async (bounds: Bounds, grid: ClusterGrid | undefined): Promise<Cluster<ClusterRestaurant>[]> => {
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
	};

	const findBestRatedIn = async (bounds: Bounds): Promise<{ id: number } | undefined> => {
		const [best] = await client
			.select({ id: s.restaurants.id })
			.from(s.locations)
			.crossJoin(s.restaurants)
			.where(approvedIn(bounds))
			.orderBy(desc(s.restaurants.ratingAvg), desc(s.restaurants.reviewCount), asc(s.restaurants.id))
			.limit(1);
		return best;
	};

	const findById = async (id: number, viewerId: number | null) => {
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
	};

	const pickApproved = async (fraction: number): Promise<{ id: number } | undefined> => {
		const columns = { id: true } as const;
		const [first, last] = await Promise.all([
			client.query.restaurants.findFirst({ columns, where: { status: "approved" }, orderBy: { id: "asc" } }),
			client.query.restaurants.findFirst({ columns, where: { status: "approved" }, orderBy: { id: "desc" } }),
		]);
		if (!first || !last) return undefined;
		const share = Math.min(Math.max(fraction, 0), 1 - Number.EPSILON);
		const from = first.id + Math.floor(share * (last.id - first.id + 1));
		return client.query.restaurants.findFirst({ columns, where: { status: "approved", id: { gte: from } }, orderBy: { id: "asc" } });
	};

	return {
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

		findById,

		async findAllowed(id: number, viewerId: number | null, permission: RestaurantPermission) {
			return authorizedRead(client, viewerId, permission, await findById(id, viewerId), async (restaurant) => restaurant);
		},

		listClusters,
		findBestRatedIn,
		pickApproved,

		async explore({ search, cityId, requested, isVisitor }: ExploreRequest) {
			const { cities, city } = chooseCity(client, search, exploreCityLimit, cityId);
			const shown = city ? cityView(city) : requested;
			if (!shown) return { cities, city, view: undefined, clusters: [] };
			const view = exploreView(shown, isVisitor);
			return { cities, city, view, clusters: await clustersOn(exploreViewport(view), listClusters) };
		},

		async feelLucky(search: string, cityId: number | undefined, fraction: number) {
			if (!search) return { city: undefined, restaurant: await pickApproved(fraction) };
			const { city } = chooseCity(client, search, exploreCityLimit, cityId);
			return { city, restaurant: city && (await findBestRatedIn(cityBounds(city))) };
		},

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

		async countByStatus(citySearchId: number | undefined = undefined): Promise<Record<RestaurantStatus, number>> {
			const found = citySearchId === undefined ? undefined : eq(s.restaurants.citySearchId, citySearchId);
			const count = (status: RestaurantStatus) => client.$count(s.restaurants, and(eq(s.restaurants.status, status), found));
			const counts = await client.query.restaurants.findFirst({
				columns: {},
				extras: { approved: count("approved"), pending: count("pending"), rejected: count("rejected") },
			});
			return counts ?? { approved: 0, pending: 0, rejected: 0 };
		},

		async decide(actorId: number, ids: number[], status: "approved" | "rejected") {
			const unique = [...new Set(ids)];
			return authorizedWriteAll(client, actorId, "restaurant:moderate", (tx) => findTargetRestaurants(tx, unique), (tx, restaurants) => {
				const changed = restaurants.filter((restaurant) => restaurant.status !== status);
				for (const restaurant of changed) {
					tx.update(s.restaurants).set({ status }).where(eq(s.restaurants.id, restaurant.id)).run();
					withdrawDecision(tx, restaurant.id);
					if (restaurant.suggestedBy !== null && restaurant.suggestedBy !== actorId) {
						notify(tx, { kind: `suggestion-${status}`, recipientId: restaurant.suggestedBy, restaurantId: restaurant.id });
					}
				}
				for (const chunk of chunks(changed.map((restaurant) => restaurant.id), durableSqliteLimits.variableNumber / 2)) {
					refreshAuthorStats(tx, authorsOfReviewsAt(tx, chunk));
				}
				return { decided: restaurants.length };
			});
		},
	};
}
