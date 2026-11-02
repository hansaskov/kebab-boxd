import { describe, expect, it } from "vitest";
import * as s from "@src/db/schema";
import { createTestDatabase, insertRestaurant, insertReview, insertUser } from "@src/tests/database";

describe("admin.countOverview", () => {
	it("counts the users and restaurants of every group with one statement", async () => {
		const { client, db, recordQueries } = createTestDatabase("counts-overview");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		insertUser(client, "cleo");
		insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		insertRestaurant(client, "Mangal Express");
		insertRestaurant(client, "Dergah Kebab");
		await db.mutations.users.ban(admin.id, bob.username);

		const { result, queries } = await recordQueries(() => db.queries.admin.countOverview());

		expect(result).toEqual({ all: 3, admin: 1, banned: 1, approved: 1, pending: 2, rejected: 0 });
		expect(queries).toHaveLength(1);
	});
});

describe("restaurants.countByStatus", () => {
	it("counts the restaurants of each status with one statement", async () => {
		const { client, db, recordQueries } = createTestDatabase("counts-restaurants");
		insertRestaurant(client, "Bosporus Grill", { status: "rejected" });

		const { result, queries } = await recordQueries(() => db.queries.restaurants.countByStatus());

		expect(result).toEqual({ approved: 0, pending: 0, rejected: 1 });
		expect(queries).toHaveLength(1);
	});
});

describe("users.list", () => {
	it("reads the first page and the number of matching users with one statement", async () => {
		const { client, db, recordQueries } = createTestDatabase("counts-user-list");
		for (const name of ["ada", "adam", "adrian", "bob"]) insertUser(client, name);

		const { result, queries } = await recordQueries(() => db.queries.users.list({ search: "ad", filter: "all" }, { limit: 2, cursor: undefined }));

		expect(result.items.map((user) => user.username)).toEqual(["adrian", "adam"]);
		expect(result.total).toBe(3);
		expect(queries).toHaveLength(1);
	});
});

describe("profiles.findByUsername", () => {
	it("counts what the profile shows and leaves out banned users and restaurants that are not approved", async () => {
		const { client, db, recordQueries } = createTestDatabase("counts-profile");
		const admin = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");
		const dan = insertUser(client, "dan");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const express = insertRestaurant(client, "Mangal Express");
		client
			.insert(s.followers)
			.values([
				{ followerId: cleo.id, followingId: bob.id },
				{ followerId: dan.id, followingId: bob.id },
				{ followerId: admin.id, followingId: bob.id },
				{ followerId: bob.id, followingId: cleo.id },
			])
			.run();
		insertReview(client, bob.id, grill.id, 4);
		insertReview(client, bob.id, express.id, 3);
		client.insert(s.favorites).values([{ userId: bob.id, restaurantId: grill.id }, { userId: bob.id, restaurantId: express.id }]).run();
		client.insert(s.bucketList).values({ userId: bob.id, restaurantId: express.id }).run();
		await db.mutations.users.ban(admin.id, dan.username);

		const { result, queries } = await recordQueries(() => db.queries.profiles.findByUsername("bob", cleo.id));

		expect(result).toMatchObject({
			followerCount: 2,
			followingCount: 1,
			reviewCount: 1,
			favoriteCount: 1,
			bucketListCount: 0,
			isFollowedByViewer: true,
		});
		expect(queries).toHaveLength(1);
	});
});
