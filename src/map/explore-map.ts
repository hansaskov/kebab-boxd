import { exploreGridStep, exploreMapSize } from "@src/data/map";
import { boundsAround, type Bounds, type Coordinates } from "@src/map/coordinates";
import { searchRadiusMeters } from "@src/map/overpass";
import { fitBounds, snapToGrid, viewport, type MapView } from "@src/map/viewport";

// The map of the Explore page. The page draws it, and the database finds the Clusters on it in the same call that
// finds the City of a search, so both build it here.

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
