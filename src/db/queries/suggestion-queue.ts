import type { Client } from "@src/db/client";

// Finished links are kept for weeks, so only the latest are shown.
const maxListed = 20;

export function createSuggestionQueueQueries(client: Client) {
	return {
		// A duplicate of a restaurant that was rejected or deleted is left out: the place may be suggested again.
		async listBy(userId: number) {
			return client.query.suggestionQueue.findMany({
				columns: { id: true, link: true, status: true, name: true, createdAt: true },
				with: { duplicate: { columns: { id: true, status: true } } },
				where: {
					userId,
					OR: [{ status: { ne: "duplicate" } }, { duplicate: { status: { in: ["approved", "pending"] } } }],
				},
				orderBy: { createdAt: "desc", id: "desc" },
				limit: maxListed,
			});
		},

		// The waiting link to look up first, which may not be due yet.
		async next() {
			return client.query.suggestionQueue.findFirst({
				columns: { id: true, link: true, runAfter: true },
				where: { status: "queued" },
				orderBy: { runAfter: "asc", id: "asc" },
			});
		},
	};
}
