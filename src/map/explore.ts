import { searchRadiusMeters } from "@src/cities/overpass";
import { boundsAround, type Bounds, type Coordinates } from "@src/map/coordinates";
import { clampZoom, fitBounds, snapToGrid, viewport, type MapView, type Viewport, type ViewportSize } from "@src/map/viewport";

// The map of the Explore page. The page draws it, and the database finds the Clusters on it in the same call that
// finds the City of a search, so both build it here.

// The zoom of a map that shows a part of a city, such as the one around the location of a User.
export const defaultMapZoom = 13;

export const exploreMapSize: ViewportSize = { width: 768, height: 512 };

// The cities of the same name that the explore map offers to choose from, the most populous first.
export const exploreCityLimit = 5;

// The zoom buttons of the explore map move this many zooms, each of which shows the map twice as large.
export const exploreZoomStep = 2;

// The cells of the explore map. Those along its sides each move the map to their middle, and those inside do not
// move it. They are square on its size.
export const exploreMapCells = { columns: 6, rows: 4 };

// A move is a whole number of half cells, so a map on a grid of half cells stays on it when it moves, and when it
// zooms in. The map of a Visitor is kept on it, so that every way to a place leads to the same address, which the
// cache keeps for every Visitor.
export const exploreGridStep = exploreMapSize.width / exploreMapCells.columns / 2;

function parseNumber(params: URLSearchParams, name: string, limit: number) {
	const text = params.get(name);
	if (text === null || text.trim() === "") return undefined;
	const value = Number(text);
	return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

// The map the address asks for, as exploreHref writes it, or nothing when it does not name a valid middle. Without
// a zoom, the map has the fallback zoom.
export function parseMapView(params: URLSearchParams, fallbackZoom: number): MapView | undefined {
	const latitude = parseNumber(params, "lat", 90);
	const longitude = parseNumber(params, "lng", 180);
	if (latitude === undefined || longitude === undefined) return undefined;
	return { center: { latitude, longitude }, zoom: clampZoom(parseNumber(params, "zoom", 100) ?? fallbackZoom) };
}

type CityPlace = Coordinates & { population: number };

// The circle a CitySearch finds the Restaurants of the City in.
export function cityBounds(city: CityPlace): Bounds {
	return boundsAround(city, searchRadiusMeters(city.population));
}

// The map that shows the circle of the City.
export function cityView(city: CityPlace): MapView {
	return fitBounds(cityBounds(city), exploreMapSize, 0);
}

// The map of a Visitor stays on the grid, and so do its links. A User's map is where they put it, since they set
// their location to its middle.
export function exploreView(requested: MapView, isVisitor: boolean): MapView {
	return isVisitor ? snapToGrid(requested, exploreGridStep) : requested;
}

export function exploreViewport({ center, zoom }: MapView) {
	return viewport(center, zoom, exploreMapSize);
}

export interface ExploreMove {
	// The cell, counted from 0 at the north-west.
	column: number;
	row: number;
	// The middle of the map after the move.
	center: Coordinates;
}

// How many cells the middle of the cell at the index of a row or column of the count is from the middle of the map.
function fromMiddle(index: number, count: number) {
	return index + 0.5 - count / 2;
}

// The cells along the sides of the map, row by row from the north-west, which each move the map to their middle.
// Moving through a cell and then through the opposite one leads back.
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
