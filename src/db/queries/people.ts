import { and, eq, exists, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { containsText, unbannedUser } from "@src/db/filters";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import { asBoolean } from "@src/db/subqueries";
import type { PageItem, PageRequest } from "@src/pagination";

// Everything a user shows in a list of people, and what decides whether the viewer may follow them.
export function personCard(client: Client, viewerId: number) {
	return {
		columns: { id: true, username: true, fullname: true, role: true, bannedAt: true },
		with: { profilePicture: { columns: { url: true } } },
		extras: {
			isFollowedByViewer: (user: typeof s.users) =>
				asBoolean(
					exists(
						client
							.select({ row: sql`1` })
							.from(s.followers)
							.where(and(eq(s.followers.followerId, viewerId), eq(s.followers.followingId, user.id))),
					),
				),
		},
	} as const;
}

const pages = cursorList(s.users, ["username"], "asc");

export function createPeopleQueries(client: Client) {
	return {
		// Matches names and usernames, never email addresses: those are private.
		async search(text: string, viewerId: number, page: PageRequest) {
			return pages(page, (seek) =>
				client.query.users.findMany({
					...personCard(client, viewerId),
					where: {
						AND: [
							unbannedUser,
							{
								OR: [
									{ RAW: (user) => containsText(user.username, text) },
									{ RAW: (user) => containsText(user.fullname, text) },
								],
							},
							seek.where,
						],
					},
					orderBy: seek.orderBy,
					limit: seek.limit,
				}),
			);
		},
	};
}

export type Person = PageItem<Awaited<ReturnType<ReturnType<typeof createPeopleQueries>["search"]>>>;
