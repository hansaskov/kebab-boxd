import { clampZoom, type MapView } from "@src/map/viewport";

function parseNumber(params: URLSearchParams, name: string, limit: number) {
	const text = params.get(name);
	if (text === null || text.trim() === "") return undefined;
	const value = Number(text);
	return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined;
}

export function parseMapView(params: URLSearchParams, fallback: MapView): MapView {
	const latitude = parseNumber(params, "lat", 90);
	const longitude = parseNumber(params, "lng", 180);
	const zoom = parseNumber(params, "zoom", 100);
	return {
		center: latitude !== undefined && longitude !== undefined ? { latitude, longitude } : fallback.center,
		zoom: clampZoom(zoom ?? fallback.zoom),
	};
}
