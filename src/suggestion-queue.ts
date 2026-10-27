import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "@src/db";
import { findPlace } from "@src/map/google-maps";

// Nominatim allows one request a second, and each link needs at most one.
const tickIntervalMs = 1500;
// After an error in the worker itself, such as a database that cannot be opened.
const errorDelayMs = 60_000;

// Turns the oldest waiting link into a suggested restaurant. Returns false when no link is due.
export async function processNextSuggestion(db: Database, now = new Date()) {
	const queued = await db.queries.suggestionQueue.next();
	if (!queued || queued.runAfter > now) return false;

	// A failed lookup at Google or OpenStreetMap, or a busy database, is tried again. A link that cannot be
	// read never gets better.
	try {
		const lookup = await findPlace(queued.link);
		if (lookup) await db.mutations.suggestionQueue.finish(queued.id, lookup.place, lookup.address);
		else await db.mutations.suggestionQueue.markNotAPlace(queued.id);
	} catch (error) {
		console.error(`Could not suggest the link ${queued.link}`, error);
		await db.mutations.suggestionQueue.retryLater(queued.id, now);
	}
	return true;
}

// Works through the waiting links one at a time, then sleeps until a link is due or a new one is queued.
export function scheduleSuggestionQueue(db: Database) {
	const stopped = new AbortController();
	let queuedMeanwhile = false;
	let wake: (() => void) | undefined;

	// Without a delay it sleeps until a link is queued.
	const sleep = (delayMs: number | undefined) =>
		new Promise<void>((resolve) => {
			if (stopped.signal.aborted || queuedMeanwhile) return resolve();
			const timer = delayMs === undefined ? undefined : setTimeout(resolve, delayMs).unref();
			wake = () => {
				clearTimeout(timer);
				resolve();
			};
		});

	async function run() {
		while (!stopped.signal.aborted) {
			queuedMeanwhile = false;
			try {
				if (await processNextSuggestion(db)) {
					await delay(tickIntervalMs, undefined, { ref: false });
					continue;
				}
				const next = await db.queries.suggestionQueue.next();
				await sleep(next && next.runAfter.getTime() - Date.now());
			} catch (error) {
				console.error("Could not process the suggestion queue", error);
				await sleep(errorDelayMs);
			}
		}
	}

	const stopListening = db.mutations.suggestionQueue.onQueued(() => {
		queuedMeanwhile = true;
		wake?.();
	});
	void run();

	return () => {
		stopped.abort();
		stopListening();
		wake?.();
	};
}
