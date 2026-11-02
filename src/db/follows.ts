import { and, eq, exists, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import { writeOnUser } from "@src/db/authorize";
import type { Client } from "@src/db/client";
import { notify, withdraw } from "@src/db/notifications";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageItem, PageRequest } from "@src/pagination";

const qb = new QueryBuilder();

// Whether the viewer follows the user, as an extra of a query on users.
export function isFollowedBy(viewerId: number) {
	return (user: typeof s.users) =>
		exists(
			qb
				.select({ row: sql`1` })
				.from(s.followers)
				.where(and(eq(s.followers.followerId, viewerId), eq(s.followers.followingId, user.id))),
		).mapWith(Boolean);
}

// Everything a user shows in a list of people, and what decides whether the viewer may follow them.
export function personCard(viewerId: number) {
	return {
		columns: { id: true, username: true, fullname: true, role: true, bannedAt: true },
		with: { profilePicture: { columns: { url: true } } },
		extras: { isFollowedByViewer: isFollowedBy(viewerId) },
	} as const;
}

const followerPages = cursorList("followers", ["createdAt", "followerId"], "desc");
const followingPages = cursorList("followers", ["createdAt", "followingId"], "desc");

export function createFollows(client: Client) {
	return {
		async follow(followerId: number, username: string) {
			return writeOnUser(client, followerId, username, "user:follow", (tx, { id: followingId }) => {
				const inserted = tx
					.insert(s.followers)
					.values({ followerId, followingId })
					.onConflictDoNothing()
					.returning({ followerId: s.followers.followerId })
					.all();
				if (inserted.length > 0) notify(tx, { kind: "follow", recipientId: followingId, actorId: followerId });
			});
		},

		async unfollow(followerId: number, username: string) {
			return writeOnUser(client, followerId, username, "user:unfollow", (tx, { id: followingId }) => {
				tx.delete(s.followers)
					.where(and(eq(s.followers.followerId, followerId), eq(s.followers.followingId, followingId)))
					.run();
				withdraw(tx, { kind: "follow", recipientId: followingId, actorId: followerId });
			});
		},

		// Banned users are left out of both lists.
		async listFollowers(userId: number, viewerId: number, page: PageRequest) {
			const rows = await followerPages(page, (seek) =>
				client.query.followers.findMany({
					columns: { followerId: true, createdAt: true },
					with: { follower: personCard(viewerId) },
					...seek({ followingId: userId, follower: { bannedAt: { isNull: true } } }),
				}),
			);
			return { ...rows, items: rows.items.map((row) => row.follower) };
		},

		async listFollowing(userId: number, viewerId: number, page: PageRequest) {
			const rows = await followingPages(page, (seek) =>
				client.query.followers.findMany({
					columns: { followingId: true, createdAt: true },
					with: { following: personCard(viewerId) },
					...seek({ followerId: userId, following: { bannedAt: { isNull: true } } }),
				}),
			);
			return { ...rows, items: rows.items.map((row) => row.following) };
		},
	};
}

export type Person = PageItem<Awaited<ReturnType<ReturnType<typeof createFollows>["listFollowers"]>>>;
