import type { Bounds, Coordinates } from "@src/map/coordinates";
import { clusterCellSize } from "@src/map/clusters";
import { worldFraction, worldSize } from "@src/map/viewport";

export const storedCellZooms = { coarsest: 5, finest: 15 } as const;

export const storedCellsFinerBy = 2;

export const exactClustersFromZoom = 14;

export interface Cell {
	column: number;
	row: number;
}

function cellsAcrossWorld(zoom: number) {
	return worldSize(zoom) / clusterCellSize;
}

export function cellAt(coordinates: Coordinates, zoom: number): Cell {
	const across = cellsAcrossWorld(zoom);
	const { x, y } = worldFraction(coordinates);
	const index = (fraction: number) => Math.min(across - 1, Math.max(0, Math.floor(fraction * across)));
	return { column: index(x), row: index(y) };
}

export function cellsCovering(bounds: Bounds, zoom: number): { first: Cell; last: Cell } {
	return {
		first: cellAt({ latitude: bounds.north, longitude: bounds.west }, zoom),
		last: cellAt({ latitude: bounds.south, longitude: bounds.east }, zoom),
	};
}

export function storedZoomShowing(viewZoom: number): number | undefined {
	if (viewZoom >= exactClustersFromZoom) return undefined;
	return Math.min(storedCellZooms.finest, Math.max(storedCellZooms.coarsest, viewZoom + storedCellsFinerBy));
}
