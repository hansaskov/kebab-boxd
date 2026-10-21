import { and, count, desc, eq, gt, lt, max, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Client } from "@src/db/client";
import { encodedPlaceholder } from "@src/db/placeholder";
import * as s from "@src/db/schema";

export const inactivityTimeoutSeconds = 60 * 60 * 24 * 30; // 30 days

/** Sessions last verified at or before this time have timed out. */
function sessionsActiveSince() {
	return new Date(Date.now() - inactivityTimeoutSeconds * 1000);
}

export type SessionHistoryCursor = { before: Date } | { after: Date } | Record<string, never>;

export interface SessionHistoryPage {
	sessionId: string;
	userId: number;
	cursor: SessionHistoryCursor;
	limit: number;
}

type HistoryPageKind = "newest" | "older" | "newer";

function prepareSessionWithHistory(client: Client, kind: HistoryPageKind) {
	const earlier = alias(s.sessions, "earlier_sessions");
	const activeSince = encodedPlaceholder("activeSince", s.sessions.lastVerifiedAt);
	const cursor = encodedPlaceholder("cursor", s.history.requestedAt);

	return client.query.sessions
		.findFirst({
			columns: { id: true, createdAt: true },
			where: {
				id: sql.placeholder("sessionId"),
				userId: sql.placeholder("userId"),
				RAW: (t) => gt(t.lastVerifiedAt, activeSince),
			},
			extras: {
				requestCount: (t) => client.$count(s.history, eq(s.history.sessionId, t.id)),
				firstRequestAt: (t) =>
					sql<Date | null>`(select min(${s.history.requestedAt}) from ${s.history} where ${s.history.sessionId} = ${t.id})`.mapWith(
						s.history.requestedAt,
					),
				lastRequestAt: (t) =>
					sql<Date | null>`(select max(${s.history.requestedAt}) from ${s.history} where ${s.history.sessionId} = ${t.id})`.mapWith(
						s.history.requestedAt,
					),
				// The active sessions of the same user that signed in first, as in `listActive`.
				signInOrder: (t) =>
					sql<number>`(${client
						.select({ count: count() })
						.from(earlier)
						.where(
							and(
								eq(earlier.userId, t.userId),
								gt(earlier.lastVerifiedAt, activeSince),
								or(lt(earlier.createdAt, t.createdAt), and(eq(earlier.createdAt, t.createdAt), lt(earlier.id, t.id))),
							),
						)}) + 1`.mapWith(Number),
			},
			with: {
				history: {
					columns: { requestedAt: true, method: true, path: true, action: true, status: true },
					where:
						kind === "newer"
							? { RAW: (t) => gt(t.requestedAt, cursor) }
							: kind === "older"
								? { RAW: (t) => lt(t.requestedAt, cursor) }
								: undefined,
					// Newer pages are read from the oldest request up, then turned around.
					orderBy: { requestedAt: kind === "newer" ? "asc" : "desc" },
					limit: sql.placeholder("limit"),
				},
			},
		})
		.prepare();
}

export function createSessionQueries(client: Client) {
	const withUser = client.query.sessions
		.findFirst({
			with: { user: true },
			where: { id: sql.placeholder("id") },
		})
		.prepare();

	const lastRequestAt = max(s.history.requestedAt);
	const activeByUser = client
		.select({
			id: s.sessions.id,
			createdAt: s.sessions.createdAt,
			lastVerifiedAt: s.sessions.lastVerifiedAt,
			lastRequestAt,
			requestCount: count(s.history.requestedAt),
			signInOrder: sql<number>`row_number() over (order by ${s.sessions.createdAt}, ${s.sessions.id})`,
		})
		.from(s.sessions)
		.leftJoin(s.history, eq(s.history.sessionId, s.sessions.id))
		.where(
			and(
				eq(s.sessions.userId, sql.placeholder("userId")),
				gt(s.sessions.lastVerifiedAt, encodedPlaceholder("activeSince", s.sessions.lastVerifiedAt)),
			),
		)
		.groupBy(s.sessions.id)
		.orderBy(desc(lastRequestAt), desc(s.sessions.createdAt), desc(s.sessions.id))
		.prepare();

	const withHistory = {
		newest: prepareSessionWithHistory(client, "newest"),
		older: prepareSessionWithHistory(client, "older"),
		newer: prepareSessionWithHistory(client, "newer"),
	};

	return {
		async findWithUser(id: string) {
			return withUser.execute({ id });
		},

		async listActive(userId: number) {
			return activeByUser.all({ userId, activeSince: sessionsActiveSince() });
		},

		async findActiveWithHistory({ sessionId, userId, cursor, limit }: SessionHistoryPage) {
			const after = "after" in cursor ? cursor.after : undefined;
			const before = "before" in cursor ? cursor.before : undefined;
			const values = { sessionId, userId, activeSince: sessionsActiveSince(), limit };

			const session = await (after
				? withHistory.newer.execute({ ...values, cursor: after })
				: before
					? withHistory.older.execute({ ...values, cursor: before })
					: withHistory.newest.execute(values));

			if (!session) return undefined;

			const { history, ...rest } = session;
			const entries = after ? history.toReversed() : history;
			const newest = entries.at(0)?.requestedAt;
			const oldest = entries.at(-1)?.requestedAt;

			return {
				...rest,
				entries,
				newer: newest && session.lastRequestAt && newest < session.lastRequestAt ? newest : null,
				older: oldest && session.firstRequestAt && oldest > session.firstRequestAt ? oldest : null,
			};
		},
	};
}
