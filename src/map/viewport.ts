import type { Bounds, Coordinates } from "@src/map/coordinates";

// A map drawn on the server from Web Mercator tiles, as the slippy maps of OpenStreetMap are.
// Positions are percentages of the viewport, so the map scales with its box without client scripts.

const tileSize = 256;
const maxLatitude = 85.051_128_78;

export const minZoom = 3;
export const maxZoom = 18;

export interface ViewportSize {
	width: number;
	height: number;
}

// What the map shows: the place at its middle, and how far it is zoomed in.
export interface MapView {
	center: Coordinates;
	zoom: number;
}

export interface Placement {
	left: number;
	top: number;
}

export interface Tile extends Placement {
	url: string;
	width: number;
	height: number;
}

// A grid of square cells over the whole world at one zoom, which restaurants are clustered on. Cells stay in
// place when the map moves, so a cluster does not change while it stays in view.
export interface ClusterGrid {
	// The column of a longitude is the whole part of (longitude + 180) × columnsPerDegree.
	columnsPerDegree: number;
	// The latitudes of the edges between the rows in view, from north to south. A place is as many rows
	// south of the first row as there are edges at or north of it.
	rowEdges: number[];
}

interface Point {
	x: number;
	y: number;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function worldSize(zoom: number) {
	return tileSize * 2 ** zoom;
}

function project({ latitude, longitude }: Coordinates, zoom: number): Point {
	const size = worldSize(zoom);
	const sin = Math.sin((clamp(latitude, -maxLatitude, maxLatitude) * Math.PI) / 180);
	return {
		x: ((longitude + 180) / 360) * size,
		y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
	};
}

function unproject({ x, y }: Point, zoom: number): Coordinates {
	const size = worldSize(zoom);
	const n = Math.PI - (2 * Math.PI * y) / size;
	return {
		latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)),
		longitude: (x / size) * 360 - 180,
	};
}

function modulo(value: number, divisor: number) {
	return ((value % divisor) + divisor) % divisor;
}

// The same place, with its longitude moved into -180 to 180 after the map went round the world.
function wrapped({ latitude, longitude }: Coordinates): Coordinates {
	return { latitude, longitude: modulo(longitude + 180, 360) - 180 };
}

export function tileUrl(zoom: number, x: number, y: number) {
	return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

export function clampZoom(zoom: number) {
	return clamp(Math.round(zoom), minZoom, maxZoom);
}

// The view moved to the nearest point of a grid over the world, with squares of the step in the pixels of its zoom.
// A map whose links move it by whole steps then leads only to points of the grid, whichever way it gets there.
export function snapToGrid({ center, zoom }: MapView, step: number): MapView {
	const rounded = clampZoom(zoom);
	const { x, y } = project(center, rounded);
	return { center: wrapped(unproject({ x: Math.round(x / step) * step, y: Math.round(y / step) * step }, rounded)), zoom: rounded };
}

// The view of a map of the size that shows all of the bounds with a margin, in pixels, around them, as near as it can.
export function fitBounds(area: Bounds, { width, height }: ViewportSize, margin: number): MapView {
	const topLeft = project({ latitude: area.north, longitude: area.west }, 0);
	const bottomRight = project({ latitude: area.south, longitude: area.east }, 0);
	const scale = Math.min((width - 2 * margin) / (bottomRight.x - topLeft.x), (height - 2 * margin) / (bottomRight.y - topLeft.y));
	const middle = { x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 };
	// Bounds around a single place fit at every zoom, which makes the scale infinite.
	return { center: unproject(middle, 0), zoom: Number.isFinite(scale) ? clampZoom(Math.floor(Math.log2(scale))) : maxZoom };
}

export function viewport(requestedCenter: Coordinates, requestedZoom: number, size: ViewportSize) {
	const { width, height } = size;
	const zoom = clampZoom(requestedZoom);
	const world = worldSize(zoom);
	const projected = project(requestedCenter, zoom);
	// The world ends at the poles, so the viewport is kept inside it from north to south.
	const centerPoint = { x: projected.x, y: clamp(projected.y, height / 2, world - height / 2) };
	const origin = { x: centerPoint.x - width / 2, y: centerPoint.y - height / 2 };
	const center = unproject(centerPoint, zoom);

	const toPlacement = (point: Point): Placement => ({
		left: ((point.x - origin.x) / width) * 100,
		top: ((point.y - origin.y) / height) * 100,
	});

	const tileCount = 2 ** zoom;
	const tiles: Tile[] = [];
	for (let ty = Math.floor(origin.y / tileSize); ty * tileSize < origin.y + height; ty++) {
		if (ty < 0 || ty >= tileCount) continue;
		for (let tx = Math.floor(origin.x / tileSize); tx * tileSize < origin.x + width; tx++) {
			tiles.push({
				url: tileUrl(zoom, modulo(tx, tileCount), ty),
				...toPlacement({ x: tx * tileSize, y: ty * tileSize }),
				width: (tileSize / width) * 100,
				height: (tileSize / height) * 100,
			});
		}
	}

	const northWest = unproject(origin, zoom);
	const southEast = unproject({ x: origin.x + width, y: origin.y + height }, zoom);
	const bounds: Bounds = {
		north: northWest.latitude,
		south: southEast.latitude,
		west: Math.max(-180, northWest.longitude),
		east: Math.min(180, southEast.longitude),
	};

	return {
		center,
		zoom,
		size,
		tiles,
		bounds,
		place(coordinates: Coordinates): Placement {
			return toPlacement(project(coordinates, zoom));
		},
		// How far apart two places are on the map, in the pixels of its size.
		pixelsBetween(from: Coordinates, to: Coordinates): number {
			const a = project(from, zoom);
			const b = project(to, zoom);
			return Math.hypot(a.x - b.x, a.y - b.y);
		},
		// The middles of the cells of a grid over the viewport, row by row from the north-west.
		cellCenters(columns: number, rows: number): Coordinates[] {
			return Array.from({ length: rows * columns }, (_, index) => {
				const column = index % columns;
				const row = Math.floor(index / columns);
				const point = { x: origin.x + ((column + 0.5) * width) / columns, y: origin.y + ((row + 0.5) * height) / rows };
				return wrapped(unproject(point, zoom));
			});
		},
		// The grid with cells of the given size, in the pixels of the map, that the restaurants in view are clustered on.
		clusterGrid(cellSize: number): ClusterGrid {
			const rowEdges: number[] = [];
			for (let row = Math.floor(origin.y / cellSize) + 1; row * cellSize < origin.y + height; row++) {
				rowEdges.push(unproject({ x: 0, y: row * cellSize }, zoom).latitude);
			}
			return { columnsPerDegree: world / 360 / cellSize, rowEdges };
		},
	};
}

export type Viewport = ReturnType<typeof viewport>;
