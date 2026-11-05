import { and, eq, ne } from "drizzle-orm";
import { authorizedSubjectWrite } from "@src/db/authorize";
import type { Client, Transaction } from "@src/db/client";
import { isProblem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { CityGroupRow } from "@src/db/schema";
import { groupPrefix, searchKey, type CityList } from "@src/map/geonames";

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

export function createCities(client: Client, wake: () => void) {
	return {
		// The cities whose name starts with the search, the most populous first.
		async search(query: string, limit: number): Promise<City[]> {
			const key = searchKey(query);
			if (!key) return [];
			const group = await client.query.cityGroups.findFirst({ where: { prefix: groupPrefix(key) } });
			return citiesOf(group)
				.filter((city) => city[7].some((cityKey) => cityKey.startsWith(key)))
				.slice(0, limit)
				.map(toCity);
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
