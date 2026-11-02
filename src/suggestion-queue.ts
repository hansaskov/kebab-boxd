import type { Database } from "@src/db";
import { findPlace } from "@src/map/google-maps";

// Nominatim allows one request a second, and each link needs at most one.
const tickIntervalMs = 1500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Turns the oldest waiting link into a suggested restaurant. When no link is due, tells when the next one is.
export async function processNextSuggestion(
	db: Database,
	now = new Date(),
): Promise<{ processed: true } | { processed: false; dueAt: Date | undefined }> {
	const queued = await db.suggestionQueue.next();
	if (!queued || queued.runAfter > now) return { processed: false, dueAt: queued?.runAfter };

	// A failed lookup at Google or OpenStreetMap, or a busy database, is tried again. A link that cannot be
	// read never gets better.
	try {
		const lookup = await findPlace(queued.link);
		if (lookup) await db.suggestionQueue.finish(queued.id, lookup.place, lookup.address);
		else await db.suggestionQueue.markNotAPlace(queued.id);
	} catch (error) {
		console.error(`Could not suggest the link ${queued.link}`, error);
		await db.suggestionQueue.retryLater(queued.id, now);
	}
	return { processed: true };
}

// Works through the links that are due, one at a time. Tells when the next link is due, if one is waiting.
export async function processDueSuggestions(db: Database): Promise<Date | undefined> {
	for (;;) {
		const result = await processNextSuggestion(db);
		if (!result.processed) return result.dueAt;
		await delay(tickIntervalMs);
	}
}
