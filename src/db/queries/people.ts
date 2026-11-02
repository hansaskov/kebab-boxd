import { and, eq, exists, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageItem, PageRequest } from "@src/pagination";

// Everything a user shows in a list of people, and what decides whether the viewer may follow them.
export function personCard(client: Client, viewerId: number) {
	return {
		columns: { id: true, username: true, fullname: true, role: true, bannedAt: true },
		with: { profilePicture: { columns: { url: true } } },
		extras: {
			isFollowedByViewer: (user: typeof s.users) =>
				exists(
					client
						.select({ row: sql`1` })
						.from(s.followers)
						.where(and(eq(s.followers.followerId, viewerId), eq(s.followers.followingId, user.id))),
				).mapWith(Boolean),
		},
	} as const;
}

const pages = cursorList("users", ["username"], "asc");

export function createPeopleQueries(client: Client) {
	return {
		// Matches names and usernames, never email addresses: those are private.
		async search(text: string, viewerId: number, page: PageRequest) {
			return pages(page, (seek) =>
				client.query.users.findMany({
					...personCard(client, viewerId),
					...seek({
						bannedAt: { isNull: true },
						OR: [
							{ RAW: (user) => sql`instr(lower(${user.username}), lower(${text})) > 0` },
							{ RAW: (user) => sql`instr(lower(${user.fullname}), lower(${text})) > 0` },
						],
					}),
				}),
			);
		},
	};
}

export type Person = PageItem<Awaited<ReturnType<ReturnType<typeof createPeopleQueries>["search"]>>>;
