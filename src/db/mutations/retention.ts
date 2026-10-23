import { lt, lte } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { encodedPlaceholder } from "@src/db/placeholder";
import { inactivityTimeoutSeconds } from "@src/db/queries/sessions";
import * as s from "@src/db/schema";

export const historyRetentionSeconds = 60 * 60 * 24 * 90;

function secondsBefore(now: Date, seconds: number) {
	return new Date(now.getTime() - seconds * 1000);
}

export function createRetentionMutations(client: Client) {
	const deleteExpiredSessions = client
		.delete(s.sessions)
		.where(lte(s.sessions.lastVerifiedAt, encodedPlaceholder("expiredAt", s.sessions.lastVerifiedAt)))
		.prepare();

	const deleteOldHistory = client
		.delete(s.history)
		.where(lt(s.history.requestedAt, encodedPlaceholder("keptSince", s.history.requestedAt)))
		.prepare();

	return {
		async purge(now: Date) {
			return client.transaction(
				() => ({
					sessions: deleteExpiredSessions.run({ expiredAt: secondsBefore(now, inactivityTimeoutSeconds) }).changes,
					history: deleteOldHistory.run({ keptSince: secondsBefore(now, historyRetentionSeconds) }).changes,
				}),
				{ behavior: "immediate" },
			);
		},
	};
}
