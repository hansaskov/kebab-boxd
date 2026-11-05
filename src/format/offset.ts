import { formatDistance } from "@src/format/distance";
import { distanceInMeters, type Coordinates } from "@src/map/coordinates";

// How far north or south, and east or west, the place is from where it is seen: "200 m north and 1.4 km west".
export function formatOffset(from: Coordinates, to: Coordinates): string {
	// The shorter way round the world, so a step across the antimeridian is a small one.
	const longitudeChange = ((to.longitude - from.longitude + 540) % 360) - 180;
	const parts = [
		{ meters: distanceInMeters(from, { latitude: to.latitude, longitude: from.longitude }), direction: to.latitude >= from.latitude ? "north" : "south" },
		{ meters: distanceInMeters(from, { latitude: from.latitude, longitude: to.longitude }), direction: longitudeChange >= 0 ? "east" : "west" },
	];
	return parts
		.filter(({ meters }) => meters >= 1)
		.map(({ meters, direction }) => `${formatDistance(meters)} ${direction}`)
		.join(" and ");
}
