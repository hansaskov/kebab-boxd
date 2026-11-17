import { searchRadiusMeters } from "@src/cities/overpass";
import { boundsAround, type Bounds, type Coordinates } from "@src/map/coordinates";
import { clampZoom, fitBounds, snapToGrid, viewport, type MapView, type Viewport, type ViewportSize } from "@src/map/viewport";

export const defaultMapZoom = 13;

export const exploreMapSize: ViewportSize = { width: 768, height: 512 };

export const exploreCityLimit = 5;

export const exploreZoomStep = 2;

export const exploreMapCells = { columns: 6, rows: 4 };

export const exploreGridStep = exploreMapSize.width / exploreMapCells.columns / 2;

function parseNumber(params: URLSearchParams, name: string, limit: number) {
	const text = params.get(name);
	if (text === null || text.trim() === "") return undefined;
	const value = Number(text);
	return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

export function parseMapView(params: URLSearchParams, fallbackZoom: number): MapView | undefined {
	const latitude = parseNumber(params, "lat", 90);
	const longitude = parseNumber(params, "lng", 180);
	if (latitude === undefined || longitude === undefined) return undefined;
	return { center: { latitude, longitude }, zoom: clampZoom(parseNumber(params, "zoom", 100) ?? fallbackZoom) };
}

type CityPlace = Coordinates & { population: number };

export function cityBounds(city: CityPlace): Bounds {
	return boundsAround(city, searchRadiusMeters(city.population));
}

export function cityView(city: CityPlace): MapView {
	return fitBounds(cityBounds(city), exploreMapSize, 0);
}

export function exploreView(requested: MapView, isVisitor: boolean): MapView {
	return isVisitor ? snapToGrid(requested, exploreGridStep) : requested;
}

export function exploreViewport({ center, zoom }: MapView) {
	return viewport(center, zoom, exploreMapSize);
}

export interface ExploreMove {
	column: number;
	row: number;
	center: Coordinates;
}

function fromMiddle(index: number, count: number) {
	return index + 0.5 - count / 2;
}

export function exploreMoves(map: Viewport): ExploreMove[] {
	const { columns, rows } = exploreMapCells;
	const cellSize = exploreMapSize.width / columns;

	const moves: ExploreMove[] = [];
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			const isOnSide = row === 0 || row === rows - 1 || column === 0 || column === columns - 1;
			if (!isOnSide) continue;
			const center = map.movedCenter(fromMiddle(column, columns) * cellSize, fromMiddle(row, rows) * cellSize);
			moves.push({ column, row, center });
		}
	}
	return moves;
}
