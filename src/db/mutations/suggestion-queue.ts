import { and, eq, sql } from "drizzle-orm";
import type { Client, Transaction } from "@src/db/client";
import { isProblem, problem, type Problem } from "@src/db/mutations/authorize";
import * as s from "@src/db/schema";
import { countRows } from "@src/db/subqueries";
import { boundsAround } from "@src/map/coordinates";
import type { Place } from "@src/map/google-maps";
import type { Address } from "@src/map/nominatim";

// Two suggestions with the same name this close to each other are taken to be the same restaurant.
const duplicateDistanceMeters = 150;
// Enough to suggest a few restaurants in a row, too few to flood the queue.
export const maxQueuedPerUser = 5;
export const maxAttempts = 5;
const retryDelaySeconds = 60;

// The names are compared without case in every alphabet. SQLite's lower() only knows A to Z.
const sameName = new Intl.Collator(undefined, { sensitivity: "accent" });

export type FinishResult =
	| { status: "suggested"; id: number }
	| { status: "duplicate"; id: number }
	// The user was deleted, or the row was finished, while the place was looked up.
	| { status: "gone" };

// A rejected restaurant is no duplicate: it may be suggested again, for example with a corrected address.
function findDuplicate(tx: Transaction, { name, googleMapsId, latitude, longitude }: Place) {
	const { north, south, east, west } = boundsAround({ latitude, longitude }, duplicateDistanceMeters);
	const candidates = tx.query.restaurants
		.findMany({
			columns: { id: true, name: true, googleMapsId: true },
			where: {
				status: { in: ["approved", "pending"] },
				OR: [{ googleMapsId }, { location: { latitude: { gte: south, lte: north }, longitude: { gte: west, lte: east } } }],
			},
		})
		.sync();
	return candidates.find((restaurant) => restaurant.googleMapsId === googleMapsId || sameName.compare(restaurant.name, name) === 0);
}

export function createSuggestionQueueMutations(client: Client) {
	const queuedListeners = new Set<() => void>();

	return {
		// Lets the worker sleep while the queue is empty. Returns the function that stops listening.
		onQueued(listener: () => void) {
			queuedListeners.add(listener);
			return () => queuedListeners.delete(listener);
		},

		async queue(userId: number, link: string): Promise<{ id: number } | Problem> {
			const result = client.transaction(
				(tx) => {
					const user = tx.query.users
						.findFirst({
							columns: {},
							extras: { queued: () => countRows(client, "suggestionQueue", { userId, status: "queued" }) },
							where: { id: userId },
						})
						.sync();
					// The user was deleted after signing in.
					if (!user) return problem("account-gone");
					if (user.queued >= maxQueuedPerUser) return problem("queue-full");
					return tx.insert(s.suggestionQueue).values({ userId, link }).returning({ id: s.suggestionQueue.id }).get();
				},
				{ behavior: "immediate" },
			);
			if (!isProblem(result)) for (const listener of queuedListeners) listener();
			return result;
		},

		async finish(id: number, place: Place, address: Address): Promise<FinishResult> {
			return client.transaction(
				(tx): FinishResult => {
					const row = tx.query.suggestionQueue.findFirst({ columns: { userId: true }, where: { id, status: "queued" } }).sync();
					if (!row) return { status: "gone" };

					const duplicate = findDuplicate(tx, place);
					if (duplicate) {
						tx.update(s.suggestionQueue)
							.set({ status: "duplicate", name: place.name, duplicateId: duplicate.id })
							.where(eq(s.suggestionQueue.id, id))
							.run();
						return { status: "duplicate", id: duplicate.id };
					}

					const { name, googleMapsId, latitude, longitude } = place;
					const location = tx.insert(s.locations).values({ ...address, latitude, longitude }).returning({ id: s.locations.id }).get();
					const restaurant = tx
						.insert(s.restaurants)
						.values({ name, googleMapsId, locationId: location.id, suggestedBy: row.userId, status: "pending" })
						.returning({ id: s.restaurants.id })
						.get();
					tx.delete(s.suggestionQueue).where(eq(s.suggestionQueue.id, id)).run();
					return { status: "suggested", id: restaurant.id };
				},
				{ behavior: "immediate" },
			);
		},

		async markNotAPlace(id: number) {
			await client
				.update(s.suggestionQueue)
				.set({ status: "not-a-place" })
				.where(and(eq(s.suggestionQueue.id, id), eq(s.suggestionQueue.status, "queued")));
		},

		// Google or OpenStreetMap could not be reached, or the database was busy. Each attempt waits longer, and the last one gives up.
		async retryLater(id: number, now: Date) {
			const attempts = sql`(${s.suggestionQueue.attempts} + 1)`;
			await client
				.update(s.suggestionQueue)
				.set({
					attempts,
					status: sql`case when ${attempts} >= ${maxAttempts} then 'failed' else 'queued' end`,
					runAfter: sql`${Math.floor(now.getTime() / 1000)} + ${attempts} * ${retryDelaySeconds}`,
				})
				.where(and(eq(s.suggestionQueue.id, id), eq(s.suggestionQueue.status, "queued")));
		},
	};
}
