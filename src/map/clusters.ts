import { clusterCellSize, clusterMargin, clusterMergeDistance } from "@src/data/map";
import { distanceInMeters, type Bounds, type Coordinates } from "@src/map/coordinates";
import { clampZoom, fitBounds, maxZoom, type ClusterGrid, type MapView, type Viewport } from "@src/map/viewport";

// The restaurants of a Cluster are ranked by their RatingAvg, and those rated alike by which was added first.
export interface ClusterMember {
	id: number;
	ratingAvg: number;
}

export interface Cluster<Member extends ClusterMember = ClusterMember> {
	count: number;
	// The average position of its restaurants.
	center: Coordinates;
	bounds: Bounds;
	// The first of its restaurants in their ranking, which the cluster is named after.
	best: Member;
}

export type ListClusters<Member extends ClusterMember> = (bounds: Bounds, grid: ClusterGrid | undefined) => Promise<Cluster<Member>[]>;

function ranksBefore(a: ClusterMember, b: ClusterMember) {
	return a.ratingAvg > b.ratingAvg || (a.ratingAvg === b.ratingAvg && a.id < b.id);
}

function combine<Member extends ClusterMember>(a: Cluster<Member>, b: Cluster<Member>): Cluster<Member> {
	const count = a.count + b.count;
	const mean = (x: number, y: number) => (x * a.count + y * b.count) / count;
	return {
		count,
		center: { latitude: mean(a.center.latitude, b.center.latitude), longitude: mean(a.center.longitude, b.center.longitude) },
		bounds: {
			north: Math.max(a.bounds.north, b.bounds.north),
			south: Math.min(a.bounds.south, b.bounds.south),
			east: Math.max(a.bounds.east, b.bounds.east),
			west: Math.min(a.bounds.west, b.bounds.west),
		},
		best: ranksBefore(b.best, a.best) ? b.best : a.best,
	};
}

// Two clusters in neighbouring cells can lie close to the edge between them. Each such pair becomes one
// cluster, the larger ones taking in the smaller ones.
function mergeOverlapping<Member extends ClusterMember>(clusters: Cluster<Member>[], map: Viewport): Cluster<Member>[] {
	const merged: Cluster<Member>[] = [];
	for (const cluster of clusters.toSorted((a, b) => b.count - a.count || a.best.id - b.best.id)) {
		const index = merged.findIndex((other) => map.pixelsBetween(other.center, cluster.center) < clusterMergeDistance);
		const other = merged[index];
		if (other) merged[index] = combine(other, cluster);
		else merged.push(cluster);
	}
	return merged;
}

// The Clusters of the approved restaurants on the map, the nearest to its middle first. At the largest zoom a
// cluster could not be opened, so each restaurant is shown on its own there, even where markers cover each other.
export async function clustersOn<Member extends ClusterMember>(map: Viewport, list: ListClusters<Member>): Promise<Cluster<Member>[]> {
	const clusters =
		map.zoom < maxZoom ? mergeOverlapping(await list(map.bounds, map.clusterGrid(clusterCellSize)), map) : await list(map.bounds, undefined);
	const distance = (cluster: Cluster<Member>) => distanceInMeters(map.center, cluster.center);
	return clusters.toSorted((a, b) => distance(a) - distance(b) || a.best.id - b.best.id);
}

// Opening a cluster zooms in until its restaurants fit, and at least one step, so that it comes apart.
export function openedView(cluster: Cluster, map: Viewport): MapView {
	const fitted = fitBounds(cluster.bounds, map.size, clusterMargin);
	return { center: fitted.center, zoom: clampZoom(Math.max(fitted.zoom, map.zoom + 1)) };
}
