import type { Coordinates } from "@src/map/coordinates";
import { type Address, findAddress, searchAddress } from "@src/map/nominatim";
import { cleanPlaceName } from "@src/map/place-name";

export interface Place extends Coordinates {
	name: string;
	// The feature id in the link, such as 0x464cdf40a60240ff:0x42ef3a5ea295d42e. Not a Places API place id.
	googleMapsId: string;
}

// A place link with a search for the place instead of its pin, such as
// https://maps.google.com/?q=Shawarma+Village,+Kongensgade+13,+5000+Odense&ftid=0x…:0x…
interface UnpinnedPlace {
	name: string;
	googleMapsId: string;
	address: string;
}

const shareLinkHost = "maps.app.goo.gl";
// Google Maps shared links on goo.gl/maps/… before maps.app.goo.gl.
const oldShareLinkHost = "goo.gl";
const googleHostPattern = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;
// Google sends visitors from some countries to a consent page, with the place link in its continue parameter.
const consentHostPattern = /^consent\.google\.[a-z]{2,3}(\.[a-z]{2})?$/;
const placePathPattern = /^\/maps\/place\/([^/]+)\//;
// The place's own pin. The @latitude,longitude in the path is the middle of the map, not the place.
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

// The links Google Maps shares, and the links in the address bar on a place.
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

// The name and the address are split at the first comma, as Google Maps writes them.
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

// Where a redirect from `from` leads: the next link to open, or the place it ends at.
export function followRedirect(location: string, from: URL): { place: Place | UnpinnedPlace | undefined } | { next: URL } {
	const url = URL.parse(location, from);
	if (url && isShareLink(url)) return { next: url };
	const target = url && consentHostPattern.test(url.hostname) ? url.searchParams.get("continue") : url?.href;
	return { place: target ? parseLink(target) : undefined };
}

// A share link redirects to the place link. Only the redirects are read, never the page they point to.
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

// The place a link points to and its address from OpenStreetMap, or undefined when the link is not to a place.
// A link without a pin is placed where OpenStreetMap finds its address.
export async function findPlace(link: string): Promise<{ place: Place; address: Address } | undefined> {
	const found = await readLink(link);
	if (!found || "latitude" in found) return found && { place: found, address: await findAddress(found) };

	const { address, ...place } = found;
	const pin = await searchAddress(address);
	return pin && { place: { ...place, latitude: pin.latitude, longitude: pin.longitude }, address: pin.address };
}
