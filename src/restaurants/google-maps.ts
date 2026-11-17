import type { Coordinates } from "@src/map/coordinates";
import { type Address, findAddress, searchAddress } from "@src/restaurants/nominatim";
import { cleanPlaceName } from "@src/restaurants/place-name";

export interface Place extends Coordinates {
	name: string;
	googleMapsId: string;
}

interface UnpinnedPlace {
	name: string;
	googleMapsId: string;
	address: string;
}

const shareLinkHost = "maps.app.goo.gl";
const oldShareLinkHost = "goo.gl";
const googleHostPattern = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;
const consentHostPattern = /^consent\.google\.[a-z]{2,3}(\.[a-z]{2})?$/;
const placePathPattern = /^\/maps\/place\/([^/]+)\//;
const pinPattern = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/;
const featureIdPattern = /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/;
const featureIdParamPattern = /^0x[0-9a-f]+:0x[0-9a-f]+$/;

const lookupTimeoutMs = 10_000;
const maxRedirects = 5;

function isShareLink(url: URL) {
	if (url.protocol !== "https:") return false;
	if (url.hostname === shareLinkHost) return url.pathname.length > 1;
	return url.hostname === oldShareLinkHost && url.pathname.startsWith("/maps/") && url.pathname.length > "/maps/".length;
}

function isPlaceLink(url: URL) {
	return url.protocol === "https:" && googleHostPattern.test(url.hostname) && url.pathname.startsWith("/maps/place/");
}

function isQueryLink(url: URL) {
	if (url.protocol !== "https:" || !googleHostPattern.test(url.hostname)) return false;
	const isMapsPath = url.pathname === "/maps" || (url.hostname.startsWith("maps.") && url.pathname === "/");
	return isMapsPath && url.searchParams.has("q") && url.searchParams.has("ftid");
}

export function isGoogleMapsLink(link: string) {
	const url = URL.parse(link);
	return url !== null && (isShareLink(url) || isPlaceLink(url) || isQueryLink(url));
}

export function parsePlaceLink(link: string): Place | undefined {
	const url = URL.parse(link);
	if (!url || !isPlaceLink(url)) return undefined;

	const name = decodeName(placePathPattern.exec(url.pathname)?.[1]);
	const pin = pinPattern.exec(url.pathname);
	const googleMapsId = featureIdPattern.exec(url.pathname)?.[1];
	if (!name || !pin || !googleMapsId) return undefined;

	const latitude = Number(pin[1]);
	const longitude = Number(pin[2]);
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;

	return { name, googleMapsId, latitude, longitude };
}

export function parseQueryLink(link: string): UnpinnedPlace | undefined {
	const url = URL.parse(link);
	if (!url || !isQueryLink(url)) return undefined;

	const query = url.searchParams.get("q") ?? "";
	const comma = query.indexOf(",");
	const name = comma > 0 ? cleanPlaceName(query.slice(0, comma)) : undefined;
	const address = query.slice(comma + 1).trim();
	const googleMapsId = url.searchParams.get("ftid") ?? "";
	if (!name || !address || !featureIdParamPattern.test(googleMapsId)) return undefined;

	return { name, googleMapsId, address };
}

function parseLink(link: string) {
	return parsePlaceLink(link) ?? parseQueryLink(link);
}

function decodeName(encoded: string | undefined) {
	if (!encoded) return undefined;
	try {
		return cleanPlaceName(decodeURIComponent(encoded.replaceAll("+", " ")));
	} catch {
		return undefined;
	}
}

export function followRedirect(location: string, from: URL): { place: Place | UnpinnedPlace | undefined } | { next: URL } {
	const url = URL.parse(location, from);
	if (url && isShareLink(url)) return { next: url };
	const target = url && consentHostPattern.test(url.hostname) ? url.searchParams.get("continue") : url?.href;
	return { place: target ? parseLink(target) : undefined };
}

async function readLink(link: string): Promise<Place | UnpinnedPlace | undefined> {
	let url = URL.parse(link);
	if (!url || !isShareLink(url)) return parseLink(link);

	for (let redirect = 0; redirect < maxRedirects; redirect++) {
		const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(lookupTimeoutMs) });
		await response.body?.cancel();
		if (response.status === 404) return undefined;
		const location = response.headers.get("location");
		if (response.status < 300 || response.status >= 400 || !location) {
			throw new Error(`Google Maps answered ${response.status} for ${url.href}`);
		}
		const result = followRedirect(location, url);
		if ("place" in result) return result.place;
		url = result.next;
	}
	return undefined;
}

export async function findPlace(link: string): Promise<{ place: Place; address: Address } | undefined> {
	const found = await readLink(link);
	if (!found || "latitude" in found) return found && { place: found, address: await findAddress(found) };

	const { address, ...place } = found;
	const pin = await searchAddress(address);
	return pin && { place: { ...place, latitude: pin.latitude, longitude: pin.longitude }, address: pin.address };
}
