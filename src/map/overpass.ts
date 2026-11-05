import { countryName } from "@src/format/country";
import type { Coordinates } from "@src/map/coordinates";
import type { Address } from "@src/map/nominatim";
import { cleanPlaceName } from "@src/map/place-name";
import { userAgent } from "@src/map/user-agent";

// The Overpass API answers questions about the map data of OpenStreetMap, and a CitySearch asks it once.
// Several public servers run it, and each is tried in turn until one answers. Not every server takes requests
// from Cloudflare: on 4 November 2026 overpass-api.de refused them (521) and overpass.kumi.systems never
// answered, while these two did. overpass-api.de stays last, for runs outside Cloudflare, such as the tests.
// mail.ru answers only GET requests, so every server is asked with GET.
export const overpassServers = [
	"https://overpass.openstreetmap.fr/api/interpreter",
	"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
	"https://overpass-api.de/api/interpreter",
];
const queryTimeoutSeconds = 60;
// An alarm may run for 15 minutes, which is enough to wait for every server.
const lookupTimeoutMs = (queryTimeoutSeconds + 30) * 1000;

// What counts as kebab is broad on purpose: an Admin rejects what is not. A place counts when its cuisine or
// its name has one of these words. Many shops are only tagged as pizza places, but their name gives them away.
const kebabCuisines = [
	"kebab",
	"doner",
	"döner",
	"shawarma",
	"gyros",
	"durum",
	"dürüm",
	"souvlaki",
	"falafel",
	"turkish",
	"kurdish",
	"lebanese",
	"syrian",
	"middle_eastern",
	"arab",
	"persian",
	"iranian",
	"afghan",
];
const kebabNameWords = [
	"kebab",
	"kebap",
	"kabab",
	"kebob",
	"döner",
	"doner",
	"donner",
	"dürüm",
	"durum",
	"shawarma",
	"shawerma",
	"schawarma",
	"shaurma",
	"gyros",
	"souvlaki",
	"falafel",
];
const foodAmenities = ["fast_food", "restaurant", "food_court", "cafe"];

// GeoNames gives a city as a point. The circle around it grows with the square root of the population, as the
// area of a city roughly does: about 9 km for 600,000 people and 20 km for 3.5 million.
const minRadiusMeters = 2_000;
const maxRadiusMeters = 30_000;

export function searchRadiusMeters(population: number): number {
	return Math.round(Math.min(maxRadiusMeters, Math.max(minRadiusMeters, 1_500 + Math.sqrt(population) * 10)));
}

export function kebabQuery({ latitude, longitude }: Coordinates, radiusMeters: number): string {
	const around = `(around:${radiusMeters},${latitude},${longitude})`;
	const amenity = `["amenity"~"^(${foodAmenities.join("|")})$"]`;
	return [
		`[out:json][timeout:${queryTimeoutSeconds}];`,
		"(",
		`  nwr${amenity}["cuisine"~"${kebabCuisines.join("|")}",i]${around};`,
		`  nwr${amenity}["name"~"${kebabNameWords.join("|")}",i]${around};`,
		");",
		// A building or an area has no point of its own, so Overpass gives its center.
		"out center tags;",
	].join("\n");
}

interface OverpassElement {
	type: "node" | "way" | "relation";
	id: number;
	lat?: number;
	lon?: number;
	center?: { lat: number; lon: number };
	tags?: Record<string, string>;
}

interface OverpassAnswer {
	elements?: OverpassElement[];
	// Set when the query ran out of time or memory, and the elements are only some of the places.
	remark?: string;
}

export interface KebabPlace extends Coordinates {
	// The element on OpenStreetMap, such as node/123.
	osmId: string;
	name: string;
	// What OpenStreetMap knows of the address. The country is that of the city when it knows none.
	address: Address;
}

// The address is complete enough to skip asking Nominatim when it has a street and a city.
export function isCompleteAddress(address: Address): boolean {
	return address.addressLine1 !== null && address.city !== null;
}

function addressOf(tags: Record<string, string>, countryCode: string): Address {
	const street = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
	return {
		addressLine1: street || null,
		postalCode: tags["addr:postcode"] ?? null,
		city: tags["addr:city"] ?? null,
		country: countryName(tags["addr:country"]) ?? countryName(countryCode),
	};
}

// The named places in an answer of Overpass. A place without a name cannot be told apart from the others.
export function readKebabPlaces(body: OverpassAnswer, countryCode: string): KebabPlace[] {
	return (body.elements ?? []).flatMap((element) => {
		const point = element.center ?? (element.lat !== undefined && element.lon !== undefined ? { lat: element.lat, lon: element.lon } : undefined);
		const name = cleanPlaceName(element.tags?.["name"] ?? "");
		if (!point || !name) return [];
		return [
			{
				osmId: `${element.type}/${element.id}`,
				name,
				latitude: point.lat,
				longitude: point.lon,
				address: addressOf(element.tags ?? {}, countryCode),
			},
		];
	});
}

// Why a server did not give the places.
export interface ServerFailure {
	server: string;
	reason: string;
}

// No server gave the places.
export class OverpassUnavailableError extends Error {
	constructor(readonly failures: ServerFailure[]) {
		super(failures.map(({ server, reason }) => `${server}: ${reason}`).join("; "));
		this.name = "OverpassUnavailableError";
	}
}

// The name of the server, such as overpass.openstreetmap.fr, as the log of a CitySearch shows it.
export function serverName(url: string): string {
	return new URL(url).hostname;
}

function reasonOf(error: unknown): string {
	if (error instanceof Error && error.name === "TimeoutError") return `did not answer within ${lookupTimeoutMs / 1000} seconds`;
	return error instanceof Error ? error.message : String(error);
}

async function askServer(url: string, query: string): Promise<OverpassAnswer> {
	const response = await fetch(`${url}?${new URLSearchParams({ data: query })}`, {
		headers: { "User-Agent": userAgent },
		signal: AbortSignal.timeout(lookupTimeoutMs),
	});
	if (!response.ok) {
		await response.body?.cancel();
		throw new Error(`answered ${response.status}`);
	}
	const body = (await response.json()) as OverpassAnswer;
	if (body.remark?.includes("error")) throw new Error(`could not finish the query: ${body.remark}`);
	return body;
}

// The kebab places OpenStreetMap knows around the center of a city, from the first server that answers, with
// why the servers before it did not.
export async function findKebabPlaces(
	city: Coordinates & { population: number; countryCode: string },
	servers: readonly string[] = overpassServers,
): Promise<{ places: KebabPlace[]; server: string; failures: ServerFailure[] }> {
	const query = kebabQuery(city, searchRadiusMeters(city.population));
	const failures: ServerFailure[] = [];
	for (const url of servers) {
		try {
			const body = await askServer(url, query);
			return { places: readKebabPlaces(body, city.countryCode), server: serverName(url), failures };
		} catch (error) {
			failures.push({ server: serverName(url), reason: reasonOf(error) });
		}
	}
	throw new OverpassUnavailableError(failures);
}
