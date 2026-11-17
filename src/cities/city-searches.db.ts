import { and, eq, gt, sql } from "drizzle-orm";
import { authorizedSubjectWrite } from "@src/db/authorize";
import { maxCitySearchAttempts } from "@src/cities/city-searches";
import { findCity, searchCities, type City } from "@src/cities/cities.db";
import type { Client, Transaction } from "@src/db/client";
import { notify, withdrawCitySearchNotification } from "@src/notifications/notifications.db";
import { cursorList } from "@src/db/pagination";
import { chunks, durableSqliteLimits } from "@src/db/limits";
import { enterRestaurant, enteredRestaurantCount, findExisting } from "@src/restaurants/entered-restaurants.db";
import { isProblem, problem, type Problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import { restaurantStatuses } from "@src/db/schema";
import { plural } from "@src/plural";
import type { Address } from "@src/restaurants/nominatim";
import type { KebabPlace, ServerFailure } from "@src/cities/overpass";
import type { PageRequest } from "@src/pagination";

const maxAttempts = maxCitySearchAttempts;
const searchRetryDelaySeconds = 2 * 60;
const candidateRetryDelaySeconds = 60;
const maxEventsShown = 100;

const knownStatuses = restaurantStatuses;

const runningStatuses = ["queued", "adding"] as const;

const pages = cursorList("citySearches", ["id"], "desc");

function candidateCount(search: typeof s.citySearches) {
	return sql<number>`(select count(*) from ${s.citySearchCandidates} where ${s.citySearchCandidates.citySearchId} = ${search.id})`.mapWith(Number);
}

function minutes(seconds: number) {
	return plural(Math.round(seconds / 60), "minute");
}

function log(tx: Transaction, citySearchId: number, message: string, isError = false) {
	tx.insert(s.citySearchEvents).values({ citySearchId, message, isError }).run();
}

function logFailures(tx: Transaction, citySearchId: number, failures: ServerFailure[]) {
	for (const { server, reason } of failures) log(tx, citySearchId, `${server} ${reason}.`, true);
}

function end(tx: Transaction, search: { id: number; startedBy: number | null }, status: "finished" | "failed") {
	tx.update(s.citySearches).set({ status }).where(eq(s.citySearches.id, search.id)).run();
	if (status === "finished") {
		const added = tx.$count(s.restaurants, eq(s.restaurants.citySearchId, search.id)).sync();
		log(tx, search.id, `Done. Added ${plural(added, "restaurant")}.`);
	}
	if (search.startedBy !== null) notify(tx, { kind: "city-search-finished", recipientId: search.startedBy, citySearchId: search.id });
}

function findRunning(tx: Transaction, cityId: number) {
	return tx.query.citySearches.findFirst({ columns: { id: true }, where: { cityId, status: { in: [...runningStatuses] } } }).sync();
}

const listColumns = {
	columns: { id: true, name: true, region: true, countryCode: true, status: true, attempts: true, runAfter: true, createdAt: true },
	with: { starter: { columns: { username: true, fullname: true } } },
	extras: { restaurantCount: enteredRestaurantCount, candidateCount },
} as const;

export function createCitySearches(client: Client, wake: () => void) {
	return {
		async start(actorId: number, cityId: number, cityName: string): Promise<{ id: number } | Problem> {
			const result = authorizedSubjectWrite(client, actorId, "city-search:start", (tx): { id: number } | Problem => {
				const city = findCity(tx, cityId, cityName);
				if (!city) return problem("city-not-found");
				if (findRunning(tx, cityId)) return problem("city-search-running");
				const { id, ...copy } = city;
				return tx
					.insert(s.citySearches)
					.values({ ...copy, cityId: id, startedBy: actorId })
					.returning({ id: s.citySearches.id })
					.get();
			});
			if (!isProblem(result)) wake();
			return result;
		},

		async retry(actorId: number, id: number): Promise<{ id: number } | Problem> {
			const result = authorizedSubjectWrite(client, actorId, "city-search:start", (tx): { id: number } | Problem => {
				const search = tx.query.citySearches.findFirst({ columns: { cityId: true, status: true }, where: { id } }).sync();
				if (!search) return problem("city-search-not-found");
				if (search.status === "finished") return problem("city-search-finished");
				if (search.status === "failed" && findRunning(tx, search.cityId)) return problem("city-search-running");

				const now = new Date();
				tx.update(s.citySearches)
					.set(search.status === "failed" ? { status: "queued", attempts: 0, runAfter: now } : { runAfter: now })
					.where(eq(s.citySearches.id, id))
					.run();
				tx.update(s.citySearchCandidates)
					.set({ runAfter: now })
					.where(and(eq(s.citySearchCandidates.citySearchId, id), gt(s.citySearchCandidates.attempts, 0)))
					.run();
				withdrawCitySearchNotification(tx, id);
				log(tx, id, "An admin asked to try again now.");
				return { id };
			});
			if (!isProblem(result)) wake();
			return result;
		},

		async findCities(query: string, limit: number): Promise<(City & { isSearching: boolean })[]> {
			const cities = searchCities(client, query, limit);
			if (cities.length === 0) return [];
			const running = await client.query.citySearches.findMany({
				columns: { cityId: true },
				where: { cityId: { in: cities.map((city) => city.id) }, status: { in: [...runningStatuses] } },
			});
			const runningIds = new Set(running.map((search) => search.cityId));
			return cities.map((city) => ({ ...city, isSearching: runningIds.has(city.id) }));
		},

		async list(page: PageRequest) {
			return pages(page, (seek) => client.query.citySearches.findMany({ ...listColumns, ...seek({}) }));
		},

		async findById(id: number) {
			const search = await client.query.citySearches.findFirst({
				...listColumns,
				with: {
					...listColumns.with,
					events: { columns: { id: true, isError: true, message: true, createdAt: true }, orderBy: { id: "desc" }, limit: maxEventsShown },
				},
				where: { id },
			});
			if (!search) return undefined;
			const retryingCandidateCount = await client.$count(
				s.citySearchCandidates,
				and(eq(s.citySearchCandidates.citySearchId, id), gt(s.citySearchCandidates.attempts, 0)),
			);
			return { ...search, retryingCandidateCount };
		},

		async nextSearch() {
			return client.query.citySearches.findFirst({
				columns: { id: true, latitude: true, longitude: true, population: true, countryCode: true, runAfter: true },
				where: { status: "queued" },
				orderBy: { runAfter: "asc", id: "asc" },
			});
		},

		async saveCandidates(id: number, found: { places: KebabPlace[]; server: string; failures: ServerFailure[] }) {
			client.transaction((tx) => {
				const search = tx.query.citySearches.findFirst({ columns: { id: true, startedBy: true }, where: { id, status: "queued" } }).sync();
				if (!search) return;

				const { places, server, failures } = found;
				const known = new Set(
					chunks(places, durableSqliteLimits.variableNumber).flatMap((chunk) =>
						tx.query.restaurants
							.findMany({ columns: { osmId: true }, where: { osmId: { in: chunk.map((place) => place.osmId) } } })
							.sync()
							.map((restaurant) => restaurant.osmId),
					),
				);
				const candidates = places
					.filter((place) => !known.has(place.osmId))
					.map(({ address, ...place }) => ({ ...place, ...address, citySearchId: id }));
				const valuesPerCandidate = candidates[0] ? tx.insert(s.citySearchCandidates).values(candidates[0]).toSQL().params.length : 1;
				for (const chunk of chunks(candidates, Math.floor(durableSqliteLimits.variableNumber / valuesPerCandidate))) {
					tx.insert(s.citySearchCandidates).values(chunk).onConflictDoNothing().run();
				}

				logFailures(tx, id, failures);
				log(tx, id, `${server} found ${plural(places.length, "place")}, ${candidates.length} of them new.`);
				if (candidates.length === 0) end(tx, search, "finished");
				else tx.update(s.citySearches).set({ status: "adding" }).where(eq(s.citySearches.id, id)).run();
			});
		},

		async retrySearchLater(id: number, now: Date, failures: ServerFailure[]) {
			client.transaction((tx) => {
				const search = tx.query.citySearches
					.findFirst({ columns: { id: true, startedBy: true, attempts: true }, where: { id, status: "queued" } })
					.sync();
				if (!search) return;
				logFailures(tx, id, failures);
				const attempts = search.attempts + 1;
				if (attempts >= maxAttempts) {
					tx.update(s.citySearches).set({ attempts }).where(eq(s.citySearches.id, id)).run();
					log(tx, id, `Gave up after ${plural(attempts, "attempt")}.`, true);
					end(tx, search, "failed");
					return;
				}
				const delaySeconds = attempts * searchRetryDelaySeconds;
				tx.update(s.citySearches)
					.set({ attempts, runAfter: new Date(now.getTime() + delaySeconds * 1000) })
					.where(eq(s.citySearches.id, id))
					.run();
				log(tx, id, `Trying again in ${minutes(delaySeconds)}.`);
			});
		},

		async nextCandidate() {
			return client.query.citySearchCandidates.findFirst({
				columns: {
					id: true,
					name: true,
					latitude: true,
					longitude: true,
					addressLine1: true,
					postalCode: true,
					city: true,
					country: true,
					attempts: true,
					runAfter: true,
				},
				with: { citySearch: { columns: { name: true } } },
				orderBy: { runAfter: "asc", id: "asc" },
			});
		},

		async retryCandidateLater(id: number, now: Date, reason: string) {
			client.transaction((tx) => {
				const candidate = tx.query.citySearchCandidates.findFirst({ columns: { citySearchId: true, name: true, attempts: true }, where: { id } }).sync();
				if (!candidate) return;
				const attempts = candidate.attempts + 1;
				const delaySeconds = attempts * candidateRetryDelaySeconds;
				tx.update(s.citySearchCandidates)
					.set({ attempts, runAfter: new Date(now.getTime() + delaySeconds * 1000) })
					.where(eq(s.citySearchCandidates.id, id))
					.run();
				log(tx, candidate.citySearchId, `Could not look up the address of ${candidate.name}: ${reason}. Trying again in ${minutes(delaySeconds)}.`, true);
			});
		},

		async addCandidate(
			id: number,
			address: Address,
			{ withoutLookup = false } = {},
		): Promise<{ status: "added" | "known"; id: number } | { status: "gone" }> {
			return client.transaction((tx) => {
				const candidate = tx.query.citySearchCandidates
					.findFirst({
						columns: { citySearchId: true, osmId: true, name: true, latitude: true, longitude: true },
						with: { citySearch: { columns: { id: true, startedBy: true } } },
						where: { id },
					})
					.sync();
				if (!candidate) return { status: "gone" as const };
				const { citySearch, citySearchId, ...place } = candidate;

				const existing = findExisting(tx, place, knownStatuses);
				if (existing && existing.osmId === null) {
					tx.update(s.restaurants).set({ osmId: place.osmId }).where(eq(s.restaurants.id, existing.id)).run();
				}
				const result = existing
					? { status: "known" as const, id: existing.id }
					: { status: "added" as const, id: enterRestaurant(tx, place, address, { citySearchId }).id };
				if (result.status === "added" && withoutLookup) {
					log(tx, citySearchId, `Added ${place.name} with the address OpenStreetMap gave, which may lack the street.`, true);
				}

				tx.delete(s.citySearchCandidates).where(eq(s.citySearchCandidates.id, id)).run();
				const left = tx.query.citySearchCandidates.findFirst({ columns: { id: true }, where: { citySearchId } }).sync();
				if (!left) end(tx, citySearch, "finished");
				return result;
			});
		},
	};
}
