import { and, eq, ne } from "drizzle-orm";
import { authorizedSubjectWrite } from "@src/db/authorize";
import type { Client, Transaction } from "@src/db/client";
import { isProblem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { CityGroupRow } from "@src/db/schema";
import { groupPrefix, searchKey, type CityList } from "@src/cities/geonames";
import type { Page, PageRequest } from "@src/pagination";

export interface City {
	id: number;
	name: string;
	region: string | null;
	countryCode: string;
	latitude: number;
	longitude: number;
	population: number;
}

function toCity([id, name, region, countryCode, latitude, longitude, population]: CityGroupRow): City {
	return { id, name, region, countryCode, latitude, longitude, population };
}

function citiesOf(group: { cities: string } | undefined): CityGroupRow[] {
	return group ? (JSON.parse(group.cities) as CityGroupRow[]) : [];
}

// The city with the id, found by its name, since the cities are stored in groups by name.
export function findCity(tx: Transaction, id: number, name: string): City | undefined {
	const group = tx.query.cityGroups.findFirst({ where: { prefix: groupPrefix(searchKey(name)) } }).sync();
	const row = citiesOf(group).find((city) => city[0] === id);
	return row && toCity(row);
}

// The cities whose name starts with the search, the most populous first, as stored.
function matchingRows(client: Client, query: string): CityGroupRow[] {
	const key = searchKey(query);
	if (!key) return [];
	const group = client.query.cityGroups.findFirst({ where: { prefix: groupPrefix(key) } }).sync();
	return citiesOf(group).filter((city) => city[7].some((cityKey) => cityKey.startsWith(key)));
}

// The cities whose name starts with the search, the most populous first.
export function searchCities(client: Client, query: string, limit: number): City[] {
	return matchingRows(client, query).slice(0, limit).map(toCity);
}

// The most populous cities whose name starts with the search, and the one of them the user chose, or else the
// first. The chosen city is among them even when more populous cities have its name, since the search page leads
// to every city the search finds.
export function chooseCity(client: Client, query: string, limit: number, chosenId: number | undefined) {
	const rows = matchingRows(client, query);
	const cities = rows.slice(0, limit).map(toCity);
	const listed = cities.find((city) => city.id === chosenId);
	if (listed) return { cities, city: listed };
	const chosenRow = rows.find((row) => row[0] === chosenId);
	if (!chosenRow) return { cities, city: cities[0] };
	const chosen = toCity(chosenRow);
	return { cities: [...cities, chosen], city: chosen };
}

// A city comes before another when more people live in it, and of two as populous, when GeoNames numbered it first,
// which is how the groups are sorted. A cursor names a place in that order by the population and id of a city.
type CityKey = [population: number, id: number];

function keyOf(city: CityGroupRow): CityKey {
	return [city[6], city[0]];
}

function encodeKey([population, id]: CityKey) {
	return `${population}_${id}`;
}

function decodeKey(cursor: string): CityKey | undefined {
	const match = /^(\d{1,15})_(\d{1,15})$/.exec(cursor);
	return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function isBefore(city: CityGroupRow, [population, id]: CityKey) {
	return city[6] > population || (city[6] === population && city[0] < id);
}

function isAt(city: CityGroupRow, [population, id]: CityKey) {
	return city[6] === population && city[0] === id;
}

// One page of the cities, read as cursorList reads the pages of a table. The cursor holds the key of a city rather
// than its place in the list, so a page still starts where it should after an update of the CityList.
function pageOf(rows: CityGroupRow[], { limit, cursor }: PageRequest): Page<City> {
	const page = (start: number, end: number): Page<City> => {
		const items = rows.slice(start, end);
		const first = items.at(0);
		const last = items.at(-1);
		return {
			items: items.map(toCity),
			previous: start > 0 && first ? { before: encodeKey(keyOf(first)) } : undefined,
			next: end < rows.length && last ? { after: encodeKey(keyOf(last)) } : undefined,
			isPastEnd: false,
		};
	};
	// The number of cities before the key, which are those on the pages before it.
	const countBefore = (key: CityKey, inclusive: boolean) => rows.filter((row) => isBefore(row, key) || (inclusive && isAt(row, key))).length;

	const after = cursor && "after" in cursor ? decodeKey(cursor.after) : undefined;
	if (after) {
		const start = countBefore(after, true);
		if (start < rows.length) return page(start, start + limit);
		return { items: [], previous: start > 0 ? { before: encodeKey(after) } : undefined, next: undefined, isPastEnd: true };
	}
	const before = cursor && "before" in cursor ? decodeKey(cursor.before) : undefined;
	if (before) {
		const end = countBefore(before, false);
		if (end >= limit) return page(end - limit, end);
	}
	return page(0, limit);
}

export function createCities(client: Client, wake: () => void) {
	return {
		async search(query: string, limit: number): Promise<City[]> {
			return searchCities(client, query, limit);
		},

		// The cities whose name starts with the search, on pages, the most populous first.
		async list(query: string, page: PageRequest): Promise<Page<City>> {
			return pageOf(matchingRows(client, query), page);
		},

		// The CityList in use, if there is one, whether a newer one is being downloaded, and when the last
		// download failed, if nothing finished after it.
		async status() {
			const [current, latest, queued] = await Promise.all([
				client.query.cityListUpdates.findFirst({
					columns: { cityCount: true, updatedAt: true },
					where: { status: "finished" },
					orderBy: { id: "desc" },
				}),
				client.query.cityListUpdates.findFirst({
					columns: { status: true, error: true, updatedAt: true },
					where: { status: { ne: "queued" } },
					orderBy: { id: "desc" },
				}),
				client.query.cityListUpdates.findFirst({ columns: { id: true }, where: { status: "queued" } }),
			]);
			return {
				current: current && { cityCount: current.cityCount ?? 0, updatedAt: current.updatedAt },
				isUpdating: queued !== undefined,
				lastFailure: latest?.status === "failed" ? { at: latest.updatedAt, error: latest.error } : undefined,
			};
		},

		// Asks for the CityList to be downloaded again. Asking while it is being downloaded changes nothing.
		async requestUpdate(actorId: number) {
			const result = authorizedSubjectWrite(client, actorId, "city-list:update", (tx) => {
				const queued = tx.query.cityListUpdates.findFirst({ columns: { id: true }, where: { status: "queued" } }).sync();
				return queued ?? tx.insert(s.cityListUpdates).values({ requestedBy: actorId }).returning({ id: s.cityListUpdates.id }).get();
			});
			if (!isProblem(result)) wake();
			return result;
		},

		// The update to download next.
		async nextUpdate() {
			return client.query.cityListUpdates.findFirst({ columns: { id: true }, where: { status: "queued" }, orderBy: { id: "asc" } });
		},

		// Replaces the CityList with the one that was downloaded, all at once.
		async finishUpdate(id: number, list: CityList) {
			client.transaction((tx) => {
				tx.delete(s.cityGroups).run();
				for (const group of list.groups) tx.insert(s.cityGroups).values(group).run();
				tx.update(s.cityListUpdates)
					.set({ status: "finished", cityCount: list.cityCount })
					.where(and(eq(s.cityListUpdates.id, id), ne(s.cityListUpdates.status, "finished")))
					.run();
			});
		},

		async failUpdate(id: number, error: string) {
			await client
				.update(s.cityListUpdates)
				.set({ status: "failed", error })
				.where(and(eq(s.cityListUpdates.id, id), eq(s.cityListUpdates.status, "queued")));
		},
	};
}
