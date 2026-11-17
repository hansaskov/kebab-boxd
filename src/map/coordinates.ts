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

// How much shorter a degree of longitude is than a degree of latitude at the latitude.
function longitudeScale(latitude: number): number {
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

const kilometres = new Intl.NumberFormat("en", { style: "unit", unit: "kilometer", maximumFractionDigits: 1 });
const metres = new Intl.NumberFormat("en", { style: "unit", unit: "meter", maximumFractionDigits: 0 });

export function formatDistance(meters: number): string {
	if (meters < 1000) return metres.format(Math.max(10, Math.round(meters / 10) * 10));
	return kilometres.format(meters / 1000);
}

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

// Coordinates as Google Maps and OpenStreetMap copy them, and as a User writes their location: "55.3959, 10.3883".
export const coordinatesPattern = /^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/;

export function parseCoordinates(text: string): Coordinates | undefined {
	const match = coordinatesPattern.exec(text.trim());
	if (!match) return undefined;
	const latitude = Number(match[1]);
	const longitude = Number(match[2]);
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
	return { latitude, longitude };
}

export function formatCoordinates({ latitude, longitude }: Coordinates) {
	return `${latitude}, ${longitude}`;
}
