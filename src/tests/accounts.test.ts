import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createSession, getSession } from "@src/auth/session";
import type { ProviderAccount } from "@src/auth/provider-account";
import type { Database } from "@src/db";
import * as s from "@src/db/schema";
import { usernameSchema } from "@src/validation/username";
import { createTestDatabase, insertRestaurant, insertReview, insertUser, restaurantRow, signIn, writeReview } from "@src/tests/database";

function googleAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
	return {
		providerId: "google",
		accountId: "google-sub-1",
		fullname: "Ada Lovelace",
		email: "ada@example.com",
		emailVerified: true,
		...overrides,
	};
}

// Signs in as a User who may sign in, as the Google callback does.
async function signInWith(db: Database, account: ProviderAccount) {
	const result = await db.accounts.signIn(account);
	if (result.status !== "signed-in") throw new Error(`The sign-in was refused: ${result.status}.`);
	return result.user;
}

describe("signing in with a Provider", () => {
	it("returns the same User every time the same Account signs in", async () => {
		const { client, db } = createTestDatabase();

		const first = await signInWith(db, googleAccount());
		const second = await signInWith(db, googleAccount());

		expect(second.id).toBe(first.id);
		expect(await client.$count(s.users)).toBe(1);
	});

	it("refuses another Provider for an email address that is already registered, in any letter case", async () => {
		const { client, db } = createTestDatabase();
		await signInWith(db, googleAccount());

		expect(
			await db.accounts.signIn(googleAccount({ providerId: "github", accountId: "github-sub-1", email: "ADA@example.com" })),
		).toEqual({ status: "email-taken" });
		expect(await client.$count(s.accounts)).toBe(1);
	});

	it("marks the email address verified once the Provider vouches for it", async () => {
		const { db } = createTestDatabase();
		await signInWith(db, googleAccount({ emailVerified: false }));

		const user = await signInWith(db, googleAccount());

		expect(user.emailVerified).toBe(true);
		expect((await db.users.findByUsername(user.username))?.emailVerified).toBe(true);
	});

	it("gives a new User a valid Username that no one else has", async () => {
		const { client, db } = createTestDatabase();
		insertUser(client, "ada_2");

		const { username } = await signInWith(db, googleAccount({ fullname: "Søren-Émile O'Brien" }));
		const second = await signInWith(db, googleAccount({ accountId: "google-sub-2", email: "ada2@example.com" }));

		expect(usernameSchema.parse(username)).toBe(username);
		expect(second.username).not.toBe("ada_2");
	});
});

describe("Usernames", () => {
	it("are unique ignoring letter case", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		insertUser(client, "bob");

		const result = await db.users.updateProfile(ada.id, "ada", { fullname: "Ada", username: "BOB", pronoun: null, bio: null });

		expect(result).toEqual({ problem: "username-taken" });
	});

	it("that suggest speaking for the site are reserved in any letter case", () => {
		expect(usernameSchema.safeParse("Admin").success).toBe(false);
	});
});

describe("a ban", () => {
	it("keeps the User out, and signs them out everywhere for good", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "admin", "admin");
		const user = await signInWith(db, googleAccount());
		const session = await createSession(user.id, db);

		await db.users.ban(admin.id, user.username);

		expect(await db.accounts.signIn(googleAccount())).toEqual({ status: "banned" });
		// A session created in the moment between the ban and the refusal does not last either.
		expect(await getSession((await createSession(user.id, db)).id, db)).toBeNull();

		await db.users.unban(admin.id, user.username);

		expect(await getSession(session.id, db)).toBeNull();
	});
});

describe("the Admin role", () => {
	it("always stays with at least one User when two Admins take it from each other", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada", "admin");
		const bob = insertUser(client, "bob", "admin");

		expect(await db.users.setRole(ada.id, "bob", "user")).toMatchObject({ id: bob.id });
		expect(await db.users.setRole(bob.id, "ada", "user")).toEqual({ problem: "forbidden", permission: "user:change-role" });
		expect(client.query.users.findMany({ columns: { username: true, role: true }, orderBy: { id: "asc" } }).sync()).toEqual([
			{ username: "ada", role: "admin" },
			{ username: "bob", role: "user" },
		]);
	});
});

describe("deleting an account", () => {
	it("deletes everything of the User and keeps what belongs to others", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const suggested = insertRestaurant(client, "Mangal Express", { suggestedBy: ada.id });
		await writeReview(db, ada.id, grill.id, 10);
		const bobReview = await writeReview(db, bob.id, grill.id, 4);
		await signIn(db, ada.id);
		client.insert(s.accounts).values({ userId: ada.id, providerId: "google", accountId: "ada-google" }).run();
		await db.reviews.like(ada.id, bobReview);
		await db.follows.follow(ada.id, bob.username);
		await db.follows.follow(bob.id, ada.username);
		await db.collections.add(ada.id, grill.id, "favorites");
		await db.collections.add(ada.id, grill.id, "bucketList");

		await db.users.delete(ada.id, ada.username);

		expect(await db.users.findByUsername("ada")).toBeUndefined();
		for (const table of [s.sessions, s.accounts, s.likes, s.followers, s.favorites, s.bucketList, s.notifications]) {
			expect(await client.$count(table)).toBe(0);
		}
		expect(client.query.reviews.findMany({ columns: { id: true, likeCount: true } }).sync()).toEqual([{ id: bobReview, likeCount: 0 }]);
		expect(restaurantRow(client, grill.id)).toMatchObject({ ratingAvg: 4, reviewCount: 1 });
		expect(restaurantRow(client, suggested.id)).toMatchObject({ suggestedBy: null });
	});
});

describe("the personal data export", () => {
	it("leaves out session secrets and the private data of other users", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const bob = insertUser(client, "bob");
		await db.follows.follow(ada.id, bob.username);
		await db.reviews.like(ada.id, insertReview(client, bob.id, insertRestaurant(client, "Hasir Kebab", { status: "approved" }).id, 6).id);
		const session = await createSession(ada.id, db);
		client.update(s.users).set({ bio: "Döner fan" }).where(eq(s.users.id, ada.id)).run();

		const exported = JSON.stringify(await db.personalData.findByUser(ada.id));

		expect(exported).toContain("Döner fan");
		expect(exported).not.toContain(session.id);
		expect(exported).not.toContain(session.secretHash.toString("hex"));
		expect(exported).not.toContain(bob.email);
	});
});
