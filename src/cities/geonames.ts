import type { CityGroupRow } from "@src/db/schema";
import { userAgent } from "@src/user-agent";
import { unzipOnlyFile } from "@src/cities/zip";

const citiesUrl = "https://download.geonames.org/export/dump/cities1000.zip";
const regionsUrl = "https://download.geonames.org/export/dump/admin1CodesASCII.txt";
const downloadTimeoutMs = 120_000;

const leftOutFeatureCodes = new Set(["PPLQ", "PPLH", "PPLW", "PPLCH"]);

const prefixLength = 2;
const maxGroupBytes = 1_500_000;

const ownLetters: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };
const ownLetterPattern = new RegExp(`[${Object.keys(ownLetters).join("")}]`, "gu");

export function searchKey(text: string): string {
	return text
		.toLowerCase()
		.replace(ownLetterPattern, (letter) => ownLetters[letter] ?? letter)
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/^[^\p{L}\p{N}]+/u, "")
		.trim();
}

export function groupPrefix(key: string): string {
	return key.slice(0, prefixLength);
}

export function isShortSearch(query: string): boolean {
	return searchKey(query).length < prefixLength;
}

export function noCityText(query: string): string {
	return isShortSearch(query) ? "Type at least two letters." : `No city starts with “${query}”.`;
}

export interface CityGroup {
	prefix: string;
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
