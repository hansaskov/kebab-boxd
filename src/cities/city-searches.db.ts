import { and, eq, gt } from "drizzle-orm";
import { authorizedSubjectRead, authorizedSubjectWrite } from "@src/db/authorize";
import { maxCitySearchAttempts } from "@src/cities/city-searches";
import { findCity, searchCities, type City } from "@src/cities/cities.db";
import type { Client, Transaction } from "@src/db/client";
import { notify, withdrawCitySearchNotification } from "@src/notifications/notifications.db";
import { cursorList } from "@src/db/pagination";
import { chunks, durableSqliteLimits } from "@src/db/limits";
import { enterRestaurant, findExisting } from "@src/restaurants/entered-restaurants.db";
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

function minutes(seconds: number) {
	return plural(Math.round(seconds / 60), "minute");
}

function log(tx: Transaction, citySearchId: number, message: string, isError = false) {
	tx.insert(s.citySearchEvents).values({ citySearchId, message, isError }).run();
}

function logFailures(tx: Transaction, citySearchId: number, failures: ServerFailure[]) {
	for (const { server, reason } of failures) log(tx, citySearchId, `${server} ${reason}.`, true);
}

interface EndingSearch {
	id: number;
	startedBy: number | null;
}

function end(tx: Transaction, search: EndingSearch, status: "finished" | "failed") {
	tx.update(s.citySearches).set({ status }).where(eq(s.citySearches.id, search.id)).run();
	if (search.startedBy !== null) notify(tx, { kind: "city-search-finished", recipientId: search.startedBy, citySearchId: search.id });
}

function finish(tx: Transaction, search: EndingSearch & { restaurantCount: number }) {
	log(tx, search.id, `Done. Added ${plural(search.restaurantCount, "restaurant")}.`);
	end(tx, search, "finished");
}

function findEnding(tx: Transaction, id: number) {
	return tx.query.citySearches.findFirst({ columns: { id: true, startedBy: true, restaurantCount: true, candidateCount: true }, where: { id } }).sync();
}

function findRunning(tx: Transaction, cityId: number) {
	return tx.query.citySearches.findFirst({ columns: { id: true }, where: { cityId, status: { in: [...runningStatuses] } } }).sync();
}

const listColumns = {
	columns: {
		id: true,
		name: true,
		region: true,
		countryCode: true,
		status: true,
		attempts: true,
		runAfter: true,
		restaurantCount: true,
		candidateCount: true,
		createdAt: true,
	},
	with: { starter: { columns: { username: true, fullname: true } } },
} as const;

export function createCitySearches(client: Client, wake: () => void) {
	const findSearch = (id: number) =>
		client.query.citySearches.findFirst({
			columns: { ...listColumns.columns, retryingCandidateCount: true },
			with: {
				...listColumns.with,
				events: { columns: { id: true, isError: true, message: true, createdAt: true }, orderBy: { id: "desc" }, limit: maxEventsShown },
			},
			where: { id },
		});

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

		async findCities(query: string, limit: number, viewerId: number | null) {
			return authorizedSubjectRead(client, viewerId, "admin-console:view", async (): Promise<(City & { isSearching: boolean })[]> => {
				const cities = searchCities(client, query, limit);
				if (cities.length === 0) return [];
				const running = await client.query.citySearches.findMany({
					columns: { cityId: true },
					where: { cityId: { in: cities.map((city) => city.id) }, status: { in: [...runningStatuses] } },
				});
				const runningIds = new Set(running.map((search) => search.cityId));
				return cities.map((city) => ({ ...city, isSearching: runningIds.has(city.id) }));
			});
		},

		async list(viewerId: number | null, page: PageRequest) {
			return authorizedSubjectRead(client, viewerId, "admin-console:view", () =>
				pages(page, (seek) => client.query.citySearches.findMany({ ...listColumns, ...seek({}) })),
			);
		},

		async findById(id: number, viewerId: number | null) {
			return authorizedSubjectRead(client, viewerId, "admin-console:view", () => findSearch(id));
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
				const isQueued = tx.query.citySearches.findFirst({ columns: { id: true }, where: { id, status: "queued" } }).sync();
				if (!isQueued) return;

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
				const search = findEnding(tx, id);
				if (!search) return;

				logFailures(tx, id, failures);
				log(tx, id, `${server} found ${plural(places.length, "place")}, ${search.candidateCount} of them new.`);
				if (search.candidateCount === 0) finish(tx, search);
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
					.findFirst({ columns: { citySearchId: true, osmId: true, name: true, latitude: true, longitude: true }, where: { id } })
					.sync();
				if (!candidate) return { status: "gone" as const };
				const { citySearchId, ...place } = candidate;

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
				const search = findEnding(tx, citySearchId);
				if (search?.candidateCount === 0) finish(tx, search);
				return result;
			});
		},
	};
}
