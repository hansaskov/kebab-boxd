import { distanceInMeters, type Bounds, type Coordinates } from "@src/map/coordinates";
import { clampZoom, fitBounds, maxZoom, type MapView, type Viewport } from "@src/map/viewport";

export const clusterCellSize = 128;
export const clusterMergeDistance = 40;
export const clusterMargin = 48;

export interface ClusterMember {
	id: number;
	ratingAvg: number;
	reviewCount: number;
}

export interface Cluster<Member extends ClusterMember = ClusterMember> {
	count: number;
	center: Coordinates;
	bounds: Bounds;
	best: Member;
}

export type ListClusters<Member extends ClusterMember> = (map: Viewport) => Promise<Cluster<Member>[]>;

function ranksBefore(a: ClusterMember, b: ClusterMember) {
	if (a.ratingAvg !== b.ratingAvg) return a.ratingAvg > b.ratingAvg;
	if (a.reviewCount !== b.reviewCount) return a.reviewCount > b.reviewCount;
	return a.id < b.id;
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

export async function clustersOn<Member extends ClusterMember>(map: Viewport, list: ListClusters<Member>): Promise<Cluster<Member>[]> {
	const listed = await list(map);
	const clusters = map.zoom < maxZoom ? mergeOverlapping(listed, map) : listed;
	const distance = (cluster: Cluster<Member>) => distanceInMeters(map.center, cluster.center);
	return clusters.toSorted((a, b) => distance(a) - distance(b) || a.best.id - b.best.id);
}

export function openedView(cluster: Cluster, map: Viewport): MapView {
	const fitted = fitBounds(cluster.bounds, map.size, clusterMargin);
	return { center: fitted.center, zoom: clampZoom(Math.max(fitted.zoom, map.zoom + 1)) };
}
