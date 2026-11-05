import type { CityGroupRow } from "@src/db/schema";
import { userAgent } from "@src/map/user-agent";
import { unzipOnlyFile } from "@src/map/zip";

// The CityList comes from GeoNames: every populated place with at least 1,000 people, about 170,000 of them.
// GeoNames updates the files every day. They are free to use if GeoNames is credited, which the privacy page does.
const citiesUrl = "https://download.geonames.org/export/dump/cities1000.zip";
// The names of the first-level divisions of each country, such as states and regions.
const regionsUrl = "https://download.geonames.org/export/dump/admin1CodesASCII.txt";
const downloadTimeoutMs = 120_000;

// Abandoned, historical and destroyed places.
const leftOutFeatureCodes = new Set(["PPLQ", "PPLH", "PPLW", "PPLCH"]);

const prefixLength = 2;
// Leaves room below the 2 MB a row may hold. The largest group, of the cities starting with "sa", is about 0.8 MB.
const maxGroupBytes = 1_500_000;

// The letters that decomposing does not take the accent off, because they are letters of their own.
const ownLetters: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };
const ownLetterPattern = new RegExp(`[${Object.keys(ownLetters).join("")}]`, "gu");

// What a city is searched by: lowercase, without accents and without punctuation in front, so "Zürich" is
// found by "zurich" and "'Ain Defla" by "ain".
export function searchKey(text: string): string {
	return text
		.toLowerCase()
		.replace(ownLetterPattern, (letter) => ownLetters[letter] ?? letter)
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/^[^\p{L}\p{N}]+/u, "")
		.trim();
}

// The group of the cities a search key may find.
export function groupPrefix(key: string): string {
	return key.slice(0, prefixLength);
}

// A search shorter than a group prefix finds only the cities whose whole name it is, such as Å in Norway, since
// the cities that start with it are spread over many groups.
export function isShortSearch(query: string): boolean {
	return searchKey(query).length < prefixLength;
}

export interface CityGroup {
	prefix: string;
	// A JSON array of CityGroupRow, the most populous first.
	cities: string;
}

export interface CityList {
	groups: CityGroup[];
	cityCount: number;
}

async function download(url: string) {
	const response = await fetch(url, { headers: { "User-Agent": userAgent }, signal: AbortSignal.timeout(downloadTimeoutMs) });
	if (!response.ok) throw new Error(`GeoNames answered ${response.status} for ${url}`);
	return response;
}

export async function downloadCityList(): Promise<CityList> {
	const [cities, regions] = await Promise.all([download(citiesUrl).then((r) => r.arrayBuffer()), download(regionsUrl).then((r) => r.text())]);
	return readCityList(new Uint8Array(cities), regions);
}

// The region names by country and region code, such as "DK.21" for the Region of Southern Denmark.
function readRegions(text: string) {
	const regions = new Map<string, string>();
	for (const line of text.split("\n")) {
		const [code, name] = line.split("\t");
		if (code && name) regions.set(code, name);
	}
	return regions;
}

async function* linesOf(stream: ReadableStream<Uint8Array<ArrayBuffer>>) {
	const decoder = new TextDecoder();
	let rest = "";
	for await (const chunk of stream) {
		const lines = (rest + decoder.decode(chunk, { stream: true })).split("\n");
		rest = lines.pop() ?? "";
		yield* lines;
	}
	rest += decoder.decode();
	if (rest) yield rest;
}

// One line of cities1000.txt, whose columns https://download.geonames.org/export/dump/readme.txt explains.
function readCity(line: string, regions: Map<string, string>): CityGroupRow | undefined {
	const columns = line.split("\t");
	const [id, name, asciiName, , latitude, longitude, , featureCode, countryCode, , regionCode, , , , population] = columns;
	if (!id || !name || !countryCode || !featureCode || leftOutFeatureCodes.has(featureCode)) return undefined;
	const keys = [...new Set([searchKey(name), searchKey(asciiName ?? "")])].filter(Boolean);
	if (keys.length === 0) return undefined;
	return [
		Number(id),
		name,
		regions.get(`${countryCode}.${regionCode}`) ?? null,
		countryCode,
		Number(latitude),
		Number(longitude),
		Number(population) || 0,
		keys,
	];
}

interface GroupEntry {
	id: number;
	population: number;
	json: string;
}

// Groups the cities by the first letters of their search keys, the most populous first. A city whose keys
// start differently is in each of their groups.
//
// Each city is kept as the JSON it is stored as. Its name and other columns are slices of the line, which
// would keep the whole line, with its long list of alternate names, in memory: 126 MB of the 128 MB a
// Durable Object has. As JSON, the list takes about 30 MB.
export async function readCityList(zip: Uint8Array<ArrayBuffer>, regionsText: string): Promise<CityList> {
	const regions = readRegions(regionsText);
	const entries = new Map<string, GroupEntry[]>();
	let cityCount = 0;
	for await (const line of linesOf(unzipOnlyFile(zip))) {
		const city = readCity(line, regions);
		if (!city) continue;
		cityCount++;
		const entry = { id: city[0], population: city[6], json: JSON.stringify(city) };
		for (const prefix of new Set(city[7].map(groupPrefix))) {
			const group = entries.get(prefix) ?? [];
			group.push(entry);
			entries.set(prefix, group);
		}
	}

	const encoder = new TextEncoder();
	const groups = [...entries].map(([prefix, group]) => {
		const cities = `[${group
			.toSorted((a, b) => b.population - a.population || a.id - b.id)
			.map((entry) => entry.json)
			.join(",")}]`;
		const bytes = encoder.encode(cities).byteLength;
		if (bytes > maxGroupBytes) throw new Error(`The cities starting with "${prefix}" take ${bytes} bytes, more than a row may hold.`);
		return { prefix, cities };
	});
	return { groups, cityCount };
}
