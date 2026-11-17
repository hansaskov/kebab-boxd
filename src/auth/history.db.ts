import { authorizedRead, findUserSeenBy } from "@src/db/authorize";
import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import { activeSince } from "@src/auth/sessions.db";
import type { NewHistoryEntry } from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

const pages = cursorList("history", ["requestedAt", "id"], "desc");

export function createHistory(client: Client) {
	return {
		async record(entry: Required<Omit<NewHistoryEntry, "id">>) {
			await client.insert(s.history).values(entry);
		},

		async listBySession(username: string, sessionId: string, viewerId: number | null, page: PageRequest) {
			return authorizedRead(client, viewerId, "user:manage-sessions", findUserSeenBy(client, username, viewerId), async (user) =>
				pages(page, (seek) =>
					client.query.history.findMany({
						columns: { id: true, requestedAt: true, method: true, path: true, action: true, status: true, prefetched: true },
						...seek({ sessionId, session: { userId: user.id, lastVerifiedAt: { gt: activeSince() } } }),
					}),
				),
			);
		},
	};
}
