import { z } from "astro/zod";
import type { Coordinates } from "@src/map/coordinates";

const coordinatesPattern = /^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/;

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

// The format Google Maps and OpenStreetMap copy coordinates in.
export const coordinatesTextSchema = z
	.string()
	.trim()
	.max(60)
	.regex(coordinatesPattern, "Write the latitude, a comma and the longitude, such as 55.3959, 10.3883.")
	.refine((text) => parseCoordinates(text) !== undefined, "The latitude must be from -90 to 90 and the longitude from -180 to 180.");

export const coordinatesSchema = coordinatesTextSchema.transform((text) => parseCoordinates(text)!);
