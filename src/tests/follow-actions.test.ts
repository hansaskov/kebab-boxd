import { describe, expect, it } from "vitest";
import { server } from "@src/actions/index";
import { followers } from "@src/db/schema";
import { actionContext, form } from "@src/tests/actions";
import { createTestDatabase, insertUser, signIn } from "@src/tests/database";

describe("follow and unfollow actions", () => {
	it("follows a user once, however often the form is sent, and unfollows them again", async () => {
		const { client, db } = createTestDatabase("follow-unfollow");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const context = actionContext(db, await signIn(db, ada.id));

		const followed = await server.profile.follow.call(context, form({ username: "bob" }));
		await server.profile.follow.call(context, form({ username: "bob" }));

		expect(followed.error).toBeUndefined();
		expect(client.query.followers.findMany().sync()).toEqual([
			expect.objectContaining({ followerId: ada.id, followingId: bob.id }),
		]);

		const unfollowed = await server.profile.unfollow.call(context, form({ username: "bob" }));

		expect(unfollowed.error).toBeUndefined();
		expect(client.query.followers.findMany().sync()).toEqual([]);
	});

	it("does not let a user follow themselves", async () => {
		const { client, db } = createTestDatabase("follow-self");
		const ada = insertUser(client, "ada");

		const result = await server.profile.follow.call(actionContext(db, await signIn(db, ada.id)), form({ username: "ada" }));

		expect(result.error?.code).toBe("FORBIDDEN");
		expect(result.error?.message).toBe("You cannot follow this user.");
		expect(await client.$count(followers)).toBe(0);
	});

	it("does not let a user follow a banned user, but lets them unfollow one", async () => {
		const { client, db } = createTestDatabase("follow-banned");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const context = actionContext(db, await signIn(db, ada.id));
		await server.profile.follow.call(context, form({ username: "bob" }));
		await db.mutations.users.ban(admin.id, bob.username);

		const followAgain = await server.profile.follow.call(context, form({ username: "bob" }));
		const unfollow = await server.profile.unfollow.call(context, form({ username: "bob" }));

		expect(followAgain.error?.code).toBe("FORBIDDEN");
		expect(unfollow.error).toBeUndefined();
		expect(await client.$count(followers)).toBe(0);
	});

	it("refuses a follow when the user is banned after the permission check", async () => {
		const { client, db } = createTestDatabase("follow-banned-race");
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		await db.mutations.users.ban(admin.id, bob.username);

		expect(await db.mutations.follows.follow(ada.id, bob.username)).toEqual({ problem: "forbidden", permission: "user:follow" });
		expect(await client.$count(followers)).toBe(0);
	});
});

describe("an action on a user", () => {
	it("finds the user inside the transaction of the write", async () => {
		const { client, db, recordQueries } = createTestDatabase("follow-in-transaction");
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");
		const context = actionContext(db, await signIn(db, ada.id));

		const { queries } = await recordQueries(() => server.profile.follow.call(context, form({ username: "BOB" })));

		expect(queries.at(0)).toBe("begin immediate");
		expect(queries.at(-1)).toBe("commit");
	});

	it("tells that a user who does not exist does not exist", async () => {
		const { client, db } = createTestDatabase("follow-missing");
		const ada = insertUser(client, "ada");

		const result = await server.profile.follow.call(actionContext(db, await signIn(db, ada.id)), form({ username: "nobody" }));

		expect(result.error?.code).toBe("NOT_FOUND");
	});
});
