import type { Coordinates } from "@src/map/coordinates";
import type { ViewportSize } from "@src/map/viewport";

// Odense, where Kebab Boxd started.
export const defaultMapCenter: Coordinates = { latitude: 55.3959, longitude: 10.3883 };
export const defaultMapZoom = 13;
export const restaurantMapZoom = 16;

export const exploreMapSize: ViewportSize = { width: 768, height: 512 };
export const restaurantMapSize: ViewportSize = { width: 768, height: 288 };

// The cities of the same name that the explore map offers to choose from, the most populous first.
export const exploreCityLimit = 5;

// The cells of the explore map, which each move the map to their middle. They are square on its size.
export const exploreMapCells = { columns: 6, rows: 4 };

// The middle of a cell is an odd number of half cells from the middle of the map, so a map on a grid of half cells
// stays on it when it moves, and when it zooms in. The map of a Visitor is kept on it, so that every way to a
// place leads to the same address, which the cache keeps for every Visitor.
export const exploreGridStep = exploreMapSize.width / exploreMapCells.columns / 2;

// The sizes below are in the pixels of the map at its size above, which a small screen shows smaller.
// Restaurants in the same square of this size are one cluster.
export const clusterCellSize = 128;
// Clusters closer than this are one, so that their markers do not cover each other.
export const clusterMergeDistance = 40;
// Opening a cluster zooms in until its restaurants are at least this far from the edge of the map.
export const clusterMargin = 48;
