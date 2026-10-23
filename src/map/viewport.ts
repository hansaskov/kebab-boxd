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

export interface Placement {
	left: number;
	top: number;
}

export interface Tile extends Placement {
	url: string;
	width: number;
	height: number;
}

export type PanDirection = "north" | "south" | "east" | "west";

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

export function tileUrl(zoom: number, x: number, y: number) {
	return `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`;
}

export function clampZoom(zoom: number) {
	return clamp(Math.round(zoom), minZoom, maxZoom);
}

export function viewport(requestedCenter: Coordinates, requestedZoom: number, { width, height }: ViewportSize) {
	const zoom = clampZoom(requestedZoom);
	const size = worldSize(zoom);
	const projected = project(requestedCenter, zoom);
	// The world ends at the poles, so the viewport is kept inside it from north to south.
	const centerPoint = { x: projected.x, y: clamp(projected.y, height / 2, size - height / 2) };
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

	const shifts: Record<PanDirection, Point> = {
		north: { x: 0, y: -height / 2 },
		south: { x: 0, y: height / 2 },
		east: { x: width / 2, y: 0 },
		west: { x: -width / 2, y: 0 },
	};

	return {
		center,
		zoom,
		tiles,
		bounds,
		place(coordinates: Coordinates): Placement {
			return toPlacement(project(coordinates, zoom));
		},
		panned(direction: PanDirection): Coordinates {
			const shift = shifts[direction];
			const moved = unproject({ x: centerPoint.x + shift.x, y: centerPoint.y + shift.y }, zoom);
			return { latitude: moved.latitude, longitude: modulo(moved.longitude + 180, 360) - 180 };
		},
	};
}

export type Viewport = ReturnType<typeof viewport>;
