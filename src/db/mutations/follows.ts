import { and, eq } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { writeIfAuthorized } from "@src/db/mutations/authorized-write";
import { notify, withdraw } from "@src/db/mutations/notifications";
import * as s from "@src/db/schema";

export function createFollowMutations(client: Client) {
	return {
		async follow(followerId: number, followingId: number) {
			return writeIfAuthorized(client, followerId, followingId, "user:follow", (tx) => {
				const { changes } = tx.insert(s.followers).values({ followerId, followingId }).onConflictDoNothing().run();
				if (changes > 0) notify(tx, { kind: "follow", recipientId: followingId, actorId: followerId });
			});
		},

		async unfollow(followerId: number, followingId: number) {
			return writeIfAuthorized(client, followerId, followingId, "user:unfollow", (tx) => {
				tx.delete(s.followers)
					.where(and(eq(s.followers.followerId, followerId), eq(s.followers.followingId, followingId)))
					.run();
				withdraw(tx, { kind: "follow", recipientId: followingId, actorId: followerId });
			});
		},
	};
}
