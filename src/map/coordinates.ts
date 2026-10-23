export interface Coordinates {
	latitude: number;
	longitude: number;
}

export interface Bounds {
	north: number;
	south: number;
	east: number;
	west: number;
}

const earthRadiusMeters = 6_371_000;

function radians(degrees: number) {
	return (degrees * Math.PI) / 180;
}

export function distanceInMeters(from: Coordinates, to: Coordinates): number {
	const dLatitude = radians(to.latitude - from.latitude);
	const dLongitude = radians(to.longitude - from.longitude);
	const a =
		Math.sin(dLatitude / 2) ** 2 +
		Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLongitude / 2) ** 2;
	return 2 * earthRadiusMeters * Math.asin(Math.min(1, Math.sqrt(a)));
}

// How much shorter a degree of longitude is than a degree of latitude at the latitude. Squared distances
// in degrees scaled by it order places by distance as the real distance does, which SQLite can compute.
export function longitudeScale(latitude: number): number {
	return Math.cos(radians(latitude));
}

// The bounds of a square around a point, about the given distance from it to each side.
export function boundsAround(center: Coordinates, meters: number): Bounds {
	const latitudeDelta = (meters / earthRadiusMeters) * (180 / Math.PI);
	const longitudeDelta = latitudeDelta / Math.max(longitudeScale(center.latitude), 0.01);
	return {
		north: center.latitude + latitudeDelta,
		south: center.latitude - latitudeDelta,
		east: center.longitude + longitudeDelta,
		west: center.longitude - longitudeDelta,
	};
}
