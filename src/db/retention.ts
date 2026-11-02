import { and, lt, lte, ne } from "drizzle-orm";
import { finishedSuggestionRetentionSeconds, historyRetentionSeconds, inactivityTimeoutSeconds } from "@src/data/retention-periods";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";

function secondsBefore(now: Date, seconds: number) {
	return new Date(now.getTime() - seconds * 1000);
}

export function createRetention(client: Client) {
	return {
		async purge(now: Date) {
			return client.transaction(
				(tx) => ({
					sessions: tx
						.delete(s.sessions)
						.where(lte(s.sessions.lastVerifiedAt, secondsBefore(now, inactivityTimeoutSeconds)))
						.returning({ id: s.sessions.id })
						.all().length,
					history: tx
						.delete(s.history)
						.where(lt(s.history.requestedAt, secondsBefore(now, historyRetentionSeconds)))
						.returning({ id: s.history.id })
						.all().length,
					suggestionQueue: tx
						.delete(s.suggestionQueue)
						.where(
							and(
								ne(s.suggestionQueue.status, "queued"),
								lt(s.suggestionQueue.updatedAt, secondsBefore(now, finishedSuggestionRetentionSeconds)),
							),
						)
						.returning({ id: s.suggestionQueue.id })
						.all().length,
				}),
			);
		},
	};
}
