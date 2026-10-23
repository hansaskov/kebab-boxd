import type { Coordinates } from "@src/map/coordinates";
import type { ViewportSize } from "@src/map/viewport";

// Odense, where Kebab Boxd started.
export const defaultMapCenter: Coordinates = { latitude: 55.3959, longitude: 10.3883 };
export const defaultMapZoom = 13;
export const restaurantMapZoom = 16;

export const exploreMapSize: ViewportSize = { width: 768, height: 512 };
export const restaurantMapSize: ViewportSize = { width: 768, height: 288 };

export const mapMarkerLimit = 200;
export const nearbyRestaurantCount = 10;
