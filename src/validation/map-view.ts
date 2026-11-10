import { clampZoom, type MapView } from "@src/map/viewport";

function parseNumber(params: URLSearchParams, name: string, limit: number) {
	const text = params.get(name);
	if (text === null || text.trim() === "") return undefined;
	const value = Number(text);
	return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

// The map the address asks for, or nothing when it does not name a valid middle. Without a zoom, the map has the
// fallback zoom.
export function parseMapView(params: URLSearchParams, fallbackZoom: number): MapView | undefined {
	const latitude = parseNumber(params, "lat", 90);
	const longitude = parseNumber(params, "lng", 180);
	if (latitude === undefined || longitude === undefined) return undefined;
	return { center: { latitude, longitude }, zoom: clampZoom(parseNumber(params, "zoom", 100) ?? fallbackZoom) };
}
