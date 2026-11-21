import { and, asc, between, desc, eq, inArray, sql } from "drizzle-orm";
import type { RestaurantPermission } from "@src/auth/permissions";
import { authorizedRead, authorizedSubjectRead, authorizedWriteAll, findTargetRestaurants } from "@src/db/authorize";
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
import { clusterCellSize, clustersOn, type Cluster, type ListClusters } from "@src/map/clusters";
import { cellsCovering, storedCellsFinerBy, storedZoomShowing } from "@src/map/cells";
import { cityBounds, cityView, defaultMapZoom, exploreMapSize, exploreView, exploreViewport, exploreCityLimit, homeOf } from "@src/map/explore";
import type { Bounds } from "@src/map/coordinates";
import { fitBounds, maxZoom, type ClusterGrid, type MapView } from "@src/map/viewport";
import type { PageRequest } from "@src/pagination";
import { matchText, startsWithIgnoringCase, unindexed, type TextIndex } from "@src/db/text-search";

const topRatedPages = cursorList("restaurants", ["ratingAvg", "id"], "desc");
const popularPages = cursorList("restaurants", ["reviewCount", "id"], "desc");
const newestPages = cursorList("restaurants", ["id"], "desc");
const oldestPages = cursorList("restaurants", ["id"], "asc");

const summary = {
	columns: { id: true, name: true, status: true, ratingAvg: true, reviewCount: true, createdAt: true },
	with: { location: { columns: { addressLine1: true, city: true, country: true } } },
} as const;

const restaurantText: TextIndex<typeof s.restaurants> = {
	table: s.restaurants,
	searchTable: "restaurant_search",
	searchedColumns: ["name", "city"],
	startsWith: (restaurant, prefix) => startsWithIgnoringCase(restaurant.name, prefix),
};

function approvedMatching(client: Client, search: string): Filter<"restaurants"> {
	if (!search) return { status: "approved" };
	const { matches, fewIds } = matchText(client, restaurantText, search);
	if (fewIds) return { RAW: (restaurant) => sql`${unindexed(restaurant.status)} = 'approved' and ${matches(restaurant)}` };
	return { status: "approved", RAW: (restaurant) => matches(restaurant) };
}

export interface ExploreRequest {
	search: string;
	cityId: number | undefined;
	requested: MapView | undefined;
	page: PageRequest;
}

export interface ClusterRestaurant {
	id: number;
	name: string;
	ratingAvg: number;
	reviewCount: number;
}

interface ClusterRow extends ClusterRestaurant {
	count: number;
	latitude: number;
	longitude: number;
	north: number;
	south: number;
	east: number;
	west: number;
}

function toCluster({ id, name, ratingAvg, reviewCount, count, latitude, longitude, north, south, east, west }: ClusterRow): Cluster<ClusterRestaurant> {
	return { count, center: { latitude, longitude }, bounds: { north, south, east, west }, best: { id, name, ratingAvg, reviewCount } };
}

function cellOf({ columnsPerDegree, rowEdges }: ClusterGrid) {
	const { latitude, longitude } = s.locations;
	return {
		column: sql<number>`cast((${longitude} + 180) * ${columnsPerDegree} as integer)`,
		row: rowEdges.length === 0 ? sql<number>`0` : sql<number>`${sql.join(rowEdges.map((edge) => sql`(${latitude} <= ${edge})`), sql` + `)}`,
	};
}

function locationsWithin(bounds: Bounds) {
	return and(between(s.locations.latitude, bounds.south, bounds.north), between(s.locations.longitude, bounds.west, bounds.east));
}

function approvedIn(bounds: Bounds) {
	return and(eq(s.restaurants.locationId, s.locations.id), eq(s.restaurants.status, "approved"), locationsWithin(bounds));
}

function storedCellsIn(bounds: Bounds, zoom: number) {
	const cells = s.mapCells;
	const { first, last } = cellsCovering(bounds, zoom);
	return and(
		eq(cells.zoom, zoom),
		between(cells.column, first.column, last.column),
		between(cells.row, first.row, last.row),
		between(sql`${cells.latitudeSum} / ${cells.count}`, bounds.south, bounds.north),
		between(sql`${cells.longitudeSum} / ${cells.count}`, bounds.west, bounds.east),
	);
}

function approvedWithinWalkingMostReviewed({ north, south, east, west }: Bounds): Filter<"restaurants"> {
	return { status: "approved", location: { latitude: { gte: south, lte: north }, longitude: { gte: west, lte: east } } };
}

const rowsReadPerRestaurantWalked = 3;
const rowsReadPerRestaurantInView = 8;

function walkingReadsFewerRows(countInView: number, approvedCount: number, limit: number) {
	const walkedPerPage = ((limit + 1) * approvedCount) / countInView;
	return walkedPerPage * rowsReadPerRestaurantWalked < countInView * rowsReadPerRestaurantInView;
}

function storedZoomAround(bounds: Bounds) {
	return storedZoomShowing(fitBounds(bounds, exploreMapSize, 0).zoom);
}

export function createRestaurants(client: Client) {
	const listExactClusters = async (bounds: Bounds, grid: ClusterGrid | undefined): Promise<Cluster<ClusterRestaurant>[]> => {
		const cell = grid ? cellOf(grid) : { column: sql<number>`${s.restaurants.id}`, row: sql<number>`0` };
		const located = client
			.select({
				id: s.restaurants.id,
				name: s.restaurants.name,
				ratingAvg: s.restaurants.ratingAvg,
				reviewCount: s.restaurants.reviewCount,
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
				reviewCount: located.reviewCount,
				count: sql<number>`count(*) ${ofCluster}`.as("count"),
				latitude: sql<number>`avg(${located.latitude}) ${ofCluster}`.as("average_latitude"),
				longitude: sql<number>`avg(${located.longitude}) ${ofCluster}`.as("average_longitude"),
				north: sql<number>`max(${located.latitude}) ${ofCluster}`.as("north"),
				south: sql<number>`min(${located.latitude}) ${ofCluster}`.as("south"),
				east: sql<number>`max(${located.longitude}) ${ofCluster}`.as("east"),
				west: sql<number>`min(${located.longitude}) ${ofCluster}`.as("west"),
				rank: sql<number>`row_number() over (partition by ${located.column}, ${located.row} order by ${located.ratingAvg} desc, ${located.reviewCount} desc, ${located.id})`.as(
					"rank",
				),
			})
			.from(located)
			.as("ranked");

		const rows = await client.select().from(ranked).where(eq(ranked.rank, 1));
		return rows.map(toCluster);
	};

	const listStoredClusters = async (bounds: Bounds, zoom: number): Promise<Cluster<ClusterRestaurant>[]> => {
		const cells = s.mapCells;
		const inView = client
			.select({
				column: sql<number>`${cells.column} >> ${sql.raw(String(storedCellsFinerBy))}`.as("cluster_column"),
				row: sql<number>`${cells.row} >> ${sql.raw(String(storedCellsFinerBy))}`.as("cluster_row"),
				count: cells.count,
				latitudeSum: cells.latitudeSum,
				longitudeSum: cells.longitudeSum,
				north: cells.north,
				south: cells.south,
				east: cells.east,
				west: cells.west,
				bestId: cells.bestId,
				bestRatingAvg: cells.bestRatingAvg,
				bestReviewCount: cells.bestReviewCount,
			})
			.from(cells)
			.where(storedCellsIn(bounds, zoom))
			.as("in_view");

		const ofCluster = sql`over (partition by ${inView.column}, ${inView.row})`;
		const ranked = client
			.select({
				bestId: inView.bestId,
				count: sql<number>`sum(${inView.count}) ${ofCluster}`.as("count"),
				latitude: sql<number>`sum(${inView.latitudeSum}) ${ofCluster} / sum(${inView.count}) ${ofCluster}`.as("average_latitude"),
				longitude: sql<number>`sum(${inView.longitudeSum}) ${ofCluster} / sum(${inView.count}) ${ofCluster}`.as("average_longitude"),
				north: sql<number>`max(${inView.north}) ${ofCluster}`.as("north"),
				south: sql<number>`min(${inView.south}) ${ofCluster}`.as("south"),
				east: sql<number>`max(${inView.east}) ${ofCluster}`.as("east"),
				west: sql<number>`min(${inView.west}) ${ofCluster}`.as("west"),
				rank: sql<number>`row_number() over (partition by ${inView.column}, ${inView.row} order by ${inView.bestRatingAvg} desc, ${inView.bestReviewCount} desc, ${inView.bestId})`.as(
					"rank",
				),
			})
			.from(inView)
			.as("ranked");

		const rows = await client
			.select({
				id: s.restaurants.id,
				name: s.restaurants.name,
				ratingAvg: s.restaurants.ratingAvg,
				reviewCount: s.restaurants.reviewCount,
				count: ranked.count,
				latitude: ranked.latitude,
				longitude: ranked.longitude,
				north: ranked.north,
				south: ranked.south,
				east: ranked.east,
				west: ranked.west,
			})
			.from(ranked)
			.innerJoin(s.restaurants, eq(s.restaurants.id, ranked.bestId))
			.where(eq(ranked.rank, 1));
		return rows.map(toCluster);
	};

	const listClusters: ListClusters<ClusterRestaurant> = (map) => {
		const storedZoom = storedZoomShowing(map.zoom);
		if (storedZoom !== undefined) return listStoredClusters(map.bounds, storedZoom);
		return listExactClusters(map.bounds, map.zoom < maxZoom ? map.clusterGrid(clusterCellSize) : undefined);
	};

	const findBestRatedIn = async (bounds: Bounds): Promise<{ id: number } | undefined> => {
		const storedZoom = storedZoomAround(bounds);
		if (storedZoom !== undefined) {
			const cells = s.mapCells;
			const [best] = await client
				.select({ id: cells.bestId })
				.from(cells)
				.where(storedCellsIn(bounds, storedZoom))
				.orderBy(desc(cells.bestRatingAvg), desc(cells.bestReviewCount), asc(cells.bestId))
				.limit(1);
			return best;
		}
		const [best] = await client
			.select({ id: s.restaurants.id })
			.from(s.locations)
			.crossJoin(s.restaurants)
			.where(approvedIn(bounds))
			.orderBy(desc(s.restaurants.ratingAvg), desc(s.restaurants.reviewCount), asc(s.restaurants.id))
			.limit(1);
		return best;
	};

	const approvedWithinReadingLocations = (bounds: Bounds): Filter<"restaurants"> => ({
		RAW: (restaurant) =>
			sql`${unindexed(restaurant.status)} = 'approved' and ${inArray(restaurant.locationId, client.select({ id: s.locations.id }).from(s.locations).where(locationsWithin(bounds)))}`,
	});

	const listMostReviewedIn = async (bounds: Bounds, countInView: number, page: PageRequest) => {
		const approved = await client.query.restaurantCounts.findFirst({ columns: { count: true }, where: { status: "approved" } });
		const found = walkingReadsFewerRows(countInView, approved?.count ?? 0, page.limit) ? approvedWithinWalkingMostReviewed(bounds) : approvedWithinReadingLocations(bounds);
		return popularPages(page, (seek) =>
			client.query.restaurants.findMany({
				...summary,
				...seek(found),
			}),
		);
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

	const homeViewOf = (viewerId: number | null): MapView | undefined => {
		if (viewerId === null) return undefined;
		const viewer = client.query.users.findFirst({ columns: { latitude: true, longitude: true }, where: { id: viewerId } }).sync();
		const home = viewer && homeOf(viewer);
		return home && { center: home, zoom: defaultMapZoom };
	};

	const countFoundBy = async (citySearchId: number): Promise<Record<RestaurantStatus, number>> => {
		const search = await client.query.citySearches.findFirst({
			columns: { restaurantCount: true, approvedCount: true, rejectedCount: true },
			where: { id: citySearchId },
		});
		if (!search) return { approved: 0, pending: 0, rejected: 0 };
		const { restaurantCount, approvedCount, rejectedCount } = search;
		return { approved: approvedCount, pending: restaurantCount - approvedCount - rejectedCount, rejected: rejectedCount };
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
			const found = approvedMatching(client, search);
			const read = (seek: Seek<"restaurants">) =>
				client.query.restaurants.findMany({
					...summary,
					...seek(found),
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

		listClusters: (view: MapView) => clustersOn(exploreViewport(view), listClusters),
		findBestRatedIn,
		pickApproved,

		async explore({ search, cityId, requested, page }: ExploreRequest, viewerId: number | null) {
			const { cities, city } = chooseCity(client, search, exploreCityLimit, cityId);
			const shown = city ? cityView(city) : (requested ?? homeViewOf(viewerId));
			if (!shown) return { cities, city, view: undefined, clusters: [], mostReviewed: undefined };
			const view = exploreView(shown, viewerId === null);
			const map = exploreViewport(view);
			const clusters = await clustersOn(map, listClusters);
			const countInView = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
			return { cities, city, view, clusters, mostReviewed: await listMostReviewedIn(map.bounds, countInView, page) };
		},

		async feelLucky(search: string, cityId: number | undefined, fraction: number) {
			if (!search) return { city: undefined, restaurant: await pickApproved(fraction) };
			const { city } = chooseCity(client, search, exploreCityLimit, cityId);
			return { city, restaurant: city && (await findBestRatedIn(cityBounds(city))) };
		},

		async listByStatus(status: RestaurantStatus, viewerId: number | null, page: PageRequest, citySearchId: number | undefined = undefined) {
			const read = (seek: Seek<"restaurants">) =>
				client.query.restaurants.findMany({
					columns: { ...summary.columns, googleMapsId: true, osmId: true },
					with: { ...summary.with, suggester: { columns: { username: true, fullname: true } } },
					...seek({ status, ...(citySearchId !== undefined && { citySearchId }) }),
				});
			return authorizedSubjectRead(client, viewerId, "admin-console:view", () => (status === "pending" ? oldestPages(page, read) : newestPages(page, read)));
		},

		async listSuggestedBy(viewerId: number | null, page: PageRequest) {
			return authorizedSubjectRead(client, viewerId, "restaurant:suggest", (viewer) =>
				newestPages(page, (seek) =>
					client.query.restaurants.findMany({
						...summary,
						...seek({ suggestedBy: viewer.id }),
					}),
				),
			);
		},

		async countByStatus(viewerId: number | null, citySearchId: number | undefined = undefined) {
			return authorizedSubjectRead(client, viewerId, "admin-console:view", async (): Promise<Record<RestaurantStatus, number>> => {
				if (citySearchId !== undefined) return countFoundBy(citySearchId);
				const rows = await client.query.restaurantCounts.findMany();
				const counts = { approved: 0, pending: 0, rejected: 0 };
				for (const { status, count } of rows) counts[status] = count;
				return counts;
			});
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
