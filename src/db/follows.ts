import { and, eq, exists, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/sqlite-core";
import { writeOnUser } from "@src/db/authorize";
import type { Client, Transaction } from "@src/db/client";
import { notify, withdraw } from "@src/db/notifications";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import { isFollowedBy, isUnbannedUser, ofViewer } from "@src/db/visibility";
import type { PageItem, PageRequest } from "@src/pagination";

const qb = new QueryBuilder();

// Whether the viewer has asked to follow the user and waits for an answer, as an extra of a query on users.
export function isRequestedBy(viewerId: number | null) {
	return (user: typeof s.users) =>
		ofViewer(viewerId, (id) =>
			exists(
				qb
					.select({ row: sql`1` })
					.from(s.followRequests)
					.where(and(eq(s.followRequests.followerId, id), eq(s.followRequests.followingId, user.id))),
			),
		);
}

// Everything a user shows in a list of people, and what decides whether the viewer may follow them.
export function personCard(viewerId: number | null) {
	return {
		columns: { id: true, username: true, fullname: true, role: true, bannedAt: true },
		with: { profilePicture: { columns: { url: true } } },
		extras: { isFollowedByViewer: isFollowedBy(viewerId), isRequestedByViewer: isRequestedBy(viewerId) },
	} as const;
}

// How many users who are not banned wait for the user to approve them, as an extra of a query on users.
export function followRequestCount(client: Client) {
	return (user: typeof s.users) =>
		client.$count(s.followRequests, and(eq(s.followRequests.followingId, user.id), isUnbannedUser(s.followRequests.followerId)));
}

// Whether the follower did not follow before. The caller tells whom it concerns.
function startFollow(tx: Transaction, followerId: number, followingId: number) {
	const inserted = tx.insert(s.followers).values({ followerId, followingId }).onConflictDoNothing().returning({ followerId: s.followers.followerId }).all();
	return inserted.length > 0;
}

function deleteRequest(tx: Transaction, followerId: number, followingId: number) {
	const deleted = tx
		.delete(s.followRequests)
		.where(and(eq(s.followRequests.followerId, followerId), eq(s.followRequests.followingId, followingId)))
		.returning({ followerId: s.followRequests.followerId })
		.all();
	withdraw(tx, { kind: "follow-request", recipientId: followingId, actorId: followerId });
	return deleted.length > 0;
}

// Ends the Follow, or the request for it, whichever side ends it, and every Notification about it.
function endFollow(tx: Transaction, followerId: number, followingId: number) {
	tx.delete(s.followers)
		.where(and(eq(s.followers.followerId, followerId), eq(s.followers.followingId, followingId)))
		.run();
	deleteRequest(tx, followerId, followingId);
	withdraw(tx, { kind: "follow", recipientId: followingId, actorId: followerId });
	withdraw(tx, { kind: "follow-accepted", recipientId: followerId, actorId: followingId });
}

// Turns the request into a Follow. The User it waited for approves it themselves, so only the one who asked hears
// about it.
function approve(tx: Transaction, followerId: number, followingId: number) {
	if (deleteRequest(tx, followerId, followingId) && startFollow(tx, followerId, followingId)) {
		notify(tx, { kind: "follow-accepted", recipientId: followerId, actorId: followingId });
	}
}

// When a Profile becomes public, every request that waits for its User is approved.
export function approveAllFollowRequests(tx: Transaction, followingId: number) {
	const requests = tx.query.followRequests.findMany({ columns: { followerId: true }, where: { followingId } }).sync();
	for (const { followerId } of requests) approve(tx, followerId, followingId);
}

const followerPages = cursorList("followers", ["createdAt", "followerId"], "desc");
const followingPages = cursorList("followers", ["createdAt", "followingId"], "desc");
const requestPages = cursorList("followRequests", ["createdAt", "followerId"], "desc");

export function createFollows(client: Client) {
	return {
		// Follows a User with a public Profile at once, and asks one with a private Profile.
		async follow(followerId: number, username: string) {
			return writeOnUser(client, followerId, username, "user:follow", (tx, user) => {
				if (!user.isPrivate) {
					if (startFollow(tx, followerId, user.id)) notify(tx, { kind: "follow", recipientId: user.id, actorId: followerId });
					return;
				}
				const isFollower = tx.query.followers.findFirst({ columns: { followerId: true }, where: { followerId, followingId: user.id } }).sync();
				if (isFollower) return;
				const inserted = tx
					.insert(s.followRequests)
					.values({ followerId, followingId: user.id })
					.onConflictDoNothing()
					.returning({ followerId: s.followRequests.followerId })
					.all();
				if (inserted.length > 0) notify(tx, { kind: "follow-request", recipientId: user.id, actorId: followerId });
			});
		},

		// Also takes back a request that waits for an answer.
		async unfollow(followerId: number, username: string) {
			return writeOnUser(client, followerId, username, "user:unfollow", (tx, user) => endFollow(tx, followerId, user.id));
		},

		// The User named `username` asked to follow the actor.
		async approveRequest(actorId: number, username: string) {
			return writeOnUser(client, actorId, username, "user:approve-follow-request", (tx, user) => approve(tx, user.id, actorId));
		},

		// Stops the User named `username` from following the actor, or declines their request.
		async removeFollower(actorId: number, username: string) {
			return writeOnUser(client, actorId, username, "user:remove-follower", (tx, user) => endFollow(tx, user.id, actorId));
		},

		// Banned users are left out of the lists.
		async listFollowers(userId: number, viewerId: number | null, page: PageRequest) {
			const rows = await followerPages(page, (seek) =>
				client.query.followers.findMany({
					columns: { followerId: true, createdAt: true },
					with: { follower: personCard(viewerId) },
					...seek({ followingId: userId, follower: { bannedAt: { isNull: true } } }),
				}),
			);
			return { ...rows, items: rows.items.map((row) => row.follower) };
		},

		async listFollowing(userId: number, viewerId: number | null, page: PageRequest) {
			const rows = await followingPages(page, (seek) =>
				client.query.followers.findMany({
					columns: { followingId: true, createdAt: true },
					with: { following: personCard(viewerId) },
					...seek({ followerId: userId, following: { bannedAt: { isNull: true } } }),
				}),
			);
			return { ...rows, items: rows.items.map((row) => row.following) };
		},

		// The users who wait for the User to approve them, the latest first. Only for a viewer with the permission
		// user:view-follow-requests.
		async listRequests(userId: number, viewerId: number, page: PageRequest) {
			const rows = await requestPages(page, (seek) =>
				client.query.followRequests.findMany({
					columns: { followerId: true, createdAt: true },
					with: { follower: personCard(viewerId) },
					...seek({ followingId: userId, follower: { bannedAt: { isNull: true } } }),
				}),
			);
			return { ...rows, items: rows.items.map((row) => row.follower) };
		},
	};
}

export type Person = PageItem<Awaited<ReturnType<ReturnType<typeof createFollows>["listFollowers"]>>>;
