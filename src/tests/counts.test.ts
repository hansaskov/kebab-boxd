import { describe, expect, it } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";
import { allowed, createTestDatabase, insertRestaurant, insertUser } from "@src/tests/database";
import { fillAgain } from "@src/tests/migrations";

function recountedRestaurants(client: Client) {
	const count = (status: s.RestaurantStatus) => client.$count(s.restaurants, eq(s.restaurants.status, status)).sync();
	return { approved: count("approved"), pending: count("pending"), rejected: count("rejected") };
}

function recountedUsers(client: Client) {
	return {
		all: client.$count(s.users).sync(),
		admin: client.$count(s.users, eq(s.users.role, "admin")).sync(),
		banned: client.$count(s.users, isNotNull(s.users.bannedAt)).sync(),
	};
}

describe("the counts the admin pages show", () => {
	it("follow the Restaurants as they are entered and decided on", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const counts = async () => allowed(await db.restaurants.countByStatus(admin.id));

		const ids = ["Kebab Huset", "Döner Corner", "Gyros King"].map((name) => insertRestaurant(client, name).id);
		insertRestaurant(client, "Shawarma Palace", { status: "approved" });
		expect(await counts()).toEqual({ approved: 1, pending: 3, rejected: 0 });

		await db.restaurants.decide(admin.id, ids.slice(0, 2), "rejected");
		await db.restaurants.decide(admin.id, ids.slice(1), "approved");

		expect(await counts()).toEqual({ approved: 3, pending: 0, rejected: 1 });
		expect(await counts()).toEqual(recountedRestaurants(client));
	});

	it("follow the Users as they join, change role, are banned and leave", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const counts = async () => allowed(await db.users.countByFilter(admin.id));
		insertUser(client, "ada");
		insertUser(client, "bob");
		const cleo = insertUser(client, "cleo");

		await db.users.setRole(admin.id, "ada", "admin");
		await db.users.ban(admin.id, "bob");
		await db.users.ban(admin.id, "cleo");
		await db.users.unban(admin.id, "cleo");
		await db.users.delete(cleo.id, "cleo");

		expect(await counts()).toEqual({ all: 3, admin: 2, banned: 1 });
		expect(await counts()).toEqual(recountedUsers(client));
	});

	it("are filled by their migration for the rows already there", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		insertUser(client, "ada");
		await db.users.ban(admin.id, "ada");
		["Kebab Huset", "Döner Corner"].forEach((name) => insertRestaurant(client, name));
		insertRestaurant(client, "Shawarma Palace", { status: "rejected" });
		const before = { restaurants: allowed(await db.restaurants.countByStatus(admin.id)), users: allowed(await db.users.countByFilter(admin.id)) };
		client.delete(s.restaurantCounts).run();
		client.delete(s.userCounts).run();

		fillAgain(client, "counts");

		expect(before).toEqual({ restaurants: recountedRestaurants(client), users: recountedUsers(client) });
		expect(allowed(await db.restaurants.countByStatus(admin.id))).toEqual(before.restaurants);
		expect(allowed(await db.users.countByFilter(admin.id))).toEqual(before.users);
	});
});

