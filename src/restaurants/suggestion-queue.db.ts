import { and, eq, sql } from "drizzle-orm";
import { maxQueuedPerUser } from "@src/restaurants/suggestion-queue";
import type { Client } from "@src/db/client";
import { authorizedSubjectRead } from "@src/db/authorize";
import { enterRestaurant, findExisting } from "@src/restaurants/entered-restaurants.db";
import { isProblem, problem, type Problem } from "@src/db/problem";
import * as s from "@src/db/schema";
import type { Place } from "@src/restaurants/google-maps";
import type { Address } from "@src/restaurants/nominatim";

const maxListed = 20;
export const maxAttempts = 5;
const retryDelaySeconds = 60;

export type FinishResult =
	| { status: "suggested"; id: number }
	| { status: "duplicate"; id: number }
	| { status: "gone" };

const duplicateStatuses = ["approved", "pending"] as const;

export function createSuggestionQueue(client: Client, wake: () => void) {
	return {
		async listBy(viewerId: number | null) {
			return authorizedSubjectRead(client, viewerId, "restaurant:suggest", (viewer) =>
				client.query.suggestionQueue.findMany({
					columns: { id: true, link: true, status: true, name: true, createdAt: true },
					with: { duplicate: { columns: { id: true, status: true } } },
					where: {
						userId: viewer.id,
						OR: [{ status: { ne: "duplicate" } }, { duplicate: { status: { in: ["approved", "pending"] } } }],
					},
					orderBy: { createdAt: "desc", id: "desc" },
					limit: maxListed,
				}),
			);
		},

		async next() {
			return client.query.suggestionQueue.findFirst({
				columns: { id: true, link: true, runAfter: true },
				where: { status: "queued" },
				orderBy: { runAfter: "asc", id: "asc" },
			});
		},

		async queue(userId: number, link: string): Promise<{ id: number } | Problem> {
			const result = client.transaction(
				(tx) => {
					const user = tx.query.users
						.findFirst({
							columns: {},
							extras: {
								queued: client.$count(
									s.suggestionQueue,
									and(eq(s.suggestionQueue.userId, userId), eq(s.suggestionQueue.status, "queued")),
								),
							},
							where: { id: userId },
						})
						.sync();
					if (!user) return problem("account-gone");
					if (user.queued >= maxQueuedPerUser) return problem("queue-full");
					return tx.insert(s.suggestionQueue).values({ userId, link }).returning({ id: s.suggestionQueue.id }).get();
				},
			);
			if (!isProblem(result)) wake();
			return result;
		},

		async finish(id: number, place: Place, address: Address): Promise<FinishResult> {
			return client.transaction(
				(tx): FinishResult => {
					const row = tx.query.suggestionQueue.findFirst({ columns: { userId: true }, where: { id, status: "queued" } }).sync();
					if (!row) return { status: "gone" };

					const duplicate = findExisting(tx, place, duplicateStatuses);
					if (duplicate) {
						tx.update(s.suggestionQueue)
							.set({ status: "duplicate", name: place.name, duplicateId: duplicate.id })
							.where(eq(s.suggestionQueue.id, id))
							.run();
						return { status: "duplicate", id: duplicate.id };
					}

					const restaurant = enterRestaurant(tx, place, address, { suggestedBy: row.userId });
					tx.delete(s.suggestionQueue).where(eq(s.suggestionQueue.id, id)).run();
					return { status: "suggested", id: restaurant.id };
				},
			);
		},

		async markNotAPlace(id: number) {
			await client
				.update(s.suggestionQueue)
				.set({ status: "not-a-place" })
				.where(and(eq(s.suggestionQueue.id, id), eq(s.suggestionQueue.status, "queued")));
		},

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
