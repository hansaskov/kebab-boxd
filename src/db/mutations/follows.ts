import { and, eq } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { writeOnUser } from "@src/db/mutations/authorize";
import { notify, withdraw } from "@src/db/mutations/notifications";
import * as s from "@src/db/schema";

export function createFollowMutations(client: Client) {
	return {
		async follow(followerId: number, username: string) {
			return writeOnUser(client, followerId, username, "user:follow", (tx, { id: followingId }) => {
				const { changes } = tx.insert(s.followers).values({ followerId, followingId }).onConflictDoNothing().run();
				if (changes > 0) notify(tx, { kind: "follow", recipientId: followingId, actorId: followerId });
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
	};
}
