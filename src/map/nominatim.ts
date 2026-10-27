import type { NewLocation } from "@src/db/schema";
import type { Coordinates } from "@src/map/coordinates";

export type Address = Pick<NewLocation, "addressLine1" | "postalCode" | "city" | "country">;

interface NominatimAddress {
	road?: string;
	house_number?: string;
	postcode?: string;
	city?: string;
	town?: string;
	village?: string;
	hamlet?: string;
	municipality?: string;
	country_code?: string;
}

const reverseUrl = "https://nominatim.openstreetmap.org/reverse";
const searchUrl = "https://nominatim.openstreetmap.org/search";
// Nominatim refuses requests that do not name the app sending them.
const userAgent = "Kebab Boxd (https://hans.askov.dk)";
const lookupTimeoutMs = 10_000;

const countryNames = new Intl.DisplayNames("en", { type: "region", fallback: "none" });

export function toAddress(address: NominatimAddress): Address {
	const street = [address.road, address.house_number].filter(Boolean).join(" ");
	return {
		addressLine1: street || null,
		postalCode: address.postcode ?? null,
		city: address.city ?? address.town ?? address.village ?? address.hamlet ?? address.municipality ?? null,
		// Intl throws on a code that is not two letters.
		country: (address.country_code?.match(/^[a-z]{2}$/i) && countryNames.of(address.country_code.toUpperCase())) || null,
	};
}

async function ask<Body>(endpoint: string, params: Record<string, string>): Promise<Body> {
	const url = new URL(endpoint);
	url.search = new URLSearchParams({ ...params, format: "jsonv2", addressdetails: "1", "accept-language": "en" }).toString();

	const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(lookupTimeoutMs) });
	if (!response.ok) throw new Error(`Nominatim answered ${response.status}`);
	return (await response.json()) as Body;
}

// The address of the building at the coordinates, from OpenStreetMap. A place with no address, such as
// one at sea, gets an empty one.
export async function findAddress({ latitude, longitude }: Coordinates): Promise<Address> {
	const body = await ask<{ address?: NominatimAddress }>(reverseUrl, { lat: String(latitude), lon: String(longitude), zoom: "18" });
	return toAddress(body.address ?? {});
}

// Where an address written out is, from OpenStreetMap. Undefined when it cannot be found.
export async function searchAddress(query: string): Promise<(Coordinates & { address: Address }) | undefined> {
	const [found] = await ask<{ lat: string; lon: string; address?: NominatimAddress }[]>(searchUrl, { q: query, limit: "1" });
	if (!found) return undefined;
	return { latitude: Number(found.lat), longitude: Number(found.lon), address: toAddress(found.address ?? {}) };
}
