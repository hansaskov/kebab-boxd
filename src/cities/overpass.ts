import { countryName } from "@src/cities/country";
import type { Coordinates } from "@src/map/coordinates";
import type { Address } from "@src/restaurants/nominatim";
import { cleanPlaceName } from "@src/restaurants/place-name";
import { userAgent } from "@src/user-agent";

export const overpassServers = [
	"https://overpass.openstreetmap.fr/api/interpreter",
	"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
	"https://overpass-api.de/api/interpreter",
];
const queryTimeoutSeconds = 60;
const lookupTimeoutMs = (queryTimeoutSeconds + 30) * 1000;

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
	remark?: string;
}

export interface KebabPlace extends Coordinates {
	osmId: string;
	name: string;
	address: Address;
}

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

export interface ServerFailure {
	server: string;
	reason: string;
}

export class OverpassUnavailableError extends Error {
	constructor(readonly failures: ServerFailure[]) {
		super(failures.map(({ server, reason }) => `${server}: ${reason}`).join("; "));
		this.name = "OverpassUnavailableError";
	}
}

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
