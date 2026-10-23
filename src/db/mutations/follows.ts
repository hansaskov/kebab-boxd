import { and, eq, sql } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { prepareAuthorizedWrite } from "@src/db/mutations/authorized-write";
import * as s from "@src/db/schema";

export function createFollowMutations(client: Client) {
	const insert = client
		.insert(s.followers)
		.values({ followerId: sql.placeholder("followerId"), followingId: sql.placeholder("followingId") })
		.onConflictDoNothing()
		.prepare();

	const remove = client
		.delete(s.followers)
		.where(
			and(
				eq(s.followers.followerId, sql.placeholder("followerId")),
				eq(s.followers.followingId, sql.placeholder("followingId")),
			),
		)
		.prepare();

	const writeIfAuthorized = prepareAuthorizedWrite(client);

	return {
		async follow(followerId: number, followingId: number) {
			return writeIfAuthorized(followerId, followingId, "user:follow", () => {
				insert.run({ followerId, followingId });
			});
		},

		async unfollow(followerId: number, followingId: number) {
			return writeIfAuthorized(followerId, followingId, "user:unfollow", () => {
				remove.run({ followerId, followingId });
			});
		},
	};
}
