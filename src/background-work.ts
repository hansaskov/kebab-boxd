import type { Database } from "@src/db";
import { maxAttempts as maxCandidateAttempts } from "@src/db/city-searches";
import { downloadCityList } from "@src/map/geonames";
import { findPlace } from "@src/map/google-maps";
import { type Address, findAddress } from "@src/map/nominatim";
import { findKebabPlaces, isCompleteAddress, OverpassUnavailableError } from "@src/map/overpass";

// The work the Durable Object does between requests: the links in the SuggestionQueue, the CitySearches and
// the downloads of the CityList. It does one step at a time, and sleeps while no step is due.

type Step = { processed: true; askedNominatim: boolean } | { processed: false; dueAt: Date | undefined };

// Nominatim allows one request a second, and a step asks it at most once.
const nominatimIntervalMs = 1500;
// An alarm may run for 15 minutes. One that has worked this long hands the rest to the next alarm.
const workBudgetMs = 5 * 60 * 1000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const notDue = (dueAt: Date | undefined): Step => ({ processed: false, dueAt });

// Drizzle puts the whole statement in its message, so the error of SQLite it wraps tells more.
function reasonOf(error: unknown) {
	const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
	return cause instanceof Error ? cause.message : String(cause);
}

// Turns the oldest waiting link into a suggested restaurant. A failed lookup at Google or OpenStreetMap, or a
// busy database, is tried again. A link that cannot be read never gets better.
export async function processNextSuggestion(db: Database, now = new Date()): Promise<Step> {
	const queued = await db.suggestionQueue.next();
	if (!queued || queued.runAfter > now) return notDue(queued?.runAfter);

	try {
		const lookup = await findPlace(queued.link);
		if (lookup) await db.suggestionQueue.finish(queued.id, lookup.place, lookup.address);
		else await db.suggestionQueue.markNotAPlace(queued.id);
	} catch (error) {
		console.error(`Could not suggest the link ${queued.link}`, error);
		await db.suggestionQueue.retryLater(queued.id, now);
	}
	return { processed: true, askedNominatim: true };
}

// Adds the next place a CitySearch found. Nominatim is asked for its address only when OpenStreetMap knows too
// little of it. A place Nominatim keeps failing for is added with what OpenStreetMap knows, in the city searched.
export async function processNextCandidate(db: Database, now = new Date()): Promise<Step> {
	const candidate = await db.citySearches.nextCandidate();
	if (!candidate || candidate.runAfter > now) return notDue(candidate?.runAfter);

	const known: Address = { addressLine1: candidate.addressLine1, postalCode: candidate.postalCode, city: candidate.city, country: candidate.country };
	const askNominatim = !isCompleteAddress(known);
	try {
		const found = askNominatim ? await findAddress(candidate) : undefined;
		await db.citySearches.addCandidate(candidate.id, {
			addressLine1: known.addressLine1 ?? found?.addressLine1 ?? null,
			postalCode: known.postalCode ?? found?.postalCode ?? null,
			city: known.city ?? found?.city ?? null,
			// OpenStreetMap seldom tags the country, so the one Nominatim finds is more likely right near a border.
			country: found?.country ?? known.country,
		});
	} catch (error) {
		console.error(`Could not add ${candidate.name}`, error);
		if (candidate.attempts + 1 < maxCandidateAttempts) await db.citySearches.retryCandidateLater(candidate.id, now, reasonOf(error));
		else await db.citySearches.addCandidate(candidate.id, { ...known, city: known.city ?? candidate.citySearch.name }, { withoutLookup: true });
	}
	return { processed: true, askedNominatim: askNominatim };
}

// Asks Overpass for the kebab places of the oldest waiting CitySearch.
export async function processNextCitySearch(db: Database, now = new Date()): Promise<Step> {
	const search = await db.citySearches.nextSearch();
	if (!search || search.runAfter > now) return notDue(search?.runAfter);

	try {
		await db.citySearches.saveCandidates(search.id, await findKebabPlaces(search));
	} catch (error) {
		console.error(`Could not find the places of city search ${search.id}`, error);
		const failures = error instanceof OverpassUnavailableError ? error.failures : [{ server: "Saving the places", reason: `failed: ${reasonOf(error)}` }];
		await db.citySearches.retrySearchLater(search.id, now, failures);
	}
	return { processed: true, askedNominatim: false };
}

// Downloads the CityList an Admin asked for. A failed download is not tried again: the Admin sees that it
// failed and may ask again.
export async function processNextCityListUpdate(db: Database): Promise<Step> {
	const update = await db.cities.nextUpdate();
	if (!update) return notDue(undefined);

	try {
		await db.cities.finishUpdate(update.id, await downloadCityList());
	} catch (error) {
		console.error("Could not download the city list", error);
		await db.cities.failUpdate(update.id, reasonOf(error));
	}
	return { processed: true, askedNominatim: false };
}

// A User waiting for their link goes before an Admin's search, and a search that has found places adds them
// before the next search starts.
const steps = [processNextSuggestion, processNextCandidate, processNextCitySearch, processNextCityListUpdate];

function earliest(a: Date | undefined, b: Date | undefined) {
	return a && b ? (a < b ? a : b) : (a ?? b);
}

export async function processNextWork(db: Database, now = new Date()): Promise<Step> {
	let dueAt: Date | undefined;
	for (const step of steps) {
		const result = await step(db, now);
		if (result.processed) return result;
		dueAt = earliest(dueAt, result.dueAt);
	}
	return notDue(dueAt);
}

// Works through the steps that are due, one at a time. Tells when the next step is due, if one is waiting.
export async function processDueWork(db: Database): Promise<Date | undefined> {
	const deadline = Date.now() + workBudgetMs;
	for (;;) {
		const result = await processNextWork(db);
		if (!result.processed) return result.dueAt;
		if (Date.now() > deadline) return new Date();
		if (result.askedNominatim) await delay(nominatimIntervalMs);
	}
}
