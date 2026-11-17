import { describe, expect, it } from "vitest";
import type { Database } from "@src/db";
import { connectPage, type PageSession } from "@src/db/page-database";
import { answerRequest, connectDatabase, sessionViewer, type DatabaseRequest, type DatabaseRpc, type Query } from "@src/db/remote";
import { storedPictureNames } from "@src/tests/cloudflare";
import { allowed, createTestDatabase, firstPage, insertRestaurant, insertUser, signIn } from "@src/tests/database";
import { pictureFile } from "@src/tests/pictures";

function overClone(db: Database) {
	const trips: DatabaseRequest[] = [];
	const rpc: DatabaseRpc = {
		call: async (request) => {
			trips.push(request);
			return { ...structuredClone(await answerRequest(db, structuredClone(request))), wokeUp: false };
		},
	};
	return { rpc, trips };
}

function connectOverClone(db: Database) {
	const { rpc, trips } = overClone(db);
	return { remote: connectDatabase(rpc), trips };
}

function openPage(db: Database, pageSession: PageSession) {
	const { rpc, trips } = overClone(db);
	return { ...connectPage(rpc, pageSession), trips };
}

function opening(token: string, onOpened: () => void = () => undefined): PageSession {
	return { toOpen: { token, takeActionOutcome: true }, onOpened };
}

describe("The database over RPC", () => {
	it("writes a review with its pictures and reads it back", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const { remote } = connectOverClone(db);

		const result = await remote.load(remote.reviews.create(ada.id, grill.id, { rating: 8, description: "Crisp." }, [await pictureFile()]));
		const page = allowed(await remote.load(remote.reviews.listByRestaurant(grill.id, ada.id, firstPage)));

		expect(result).toMatchObject({ id: expect.any(Number) });
		expect(page.items).toEqual([expect.objectContaining({ rating: 8, description: "Crisp.", createdAt: expect.any(Date) })]);
		expect(await storedPictureNames()).toHaveLength(1);
	});

	it("refuses a method the database does not have", async () => {
		const { db } = createTestDatabase();
		const { remote } = connectOverClone(db);
		const missing = (remote.users as unknown as { constructor: () => Query<unknown> }).constructor();

		await expect(remote.load(missing)).rejects.toThrow("The database has no method users.constructor.");
	});

	it("sends the queries of one load in one call, and leaves out those that are not needed", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const grill = insertRestaurant(client, "Bosporus Grill", { status: "approved" });
		const { remote, trips } = connectOverClone(db);

		const loaded = await remote.load({
			restaurant: remote.restaurants.findById(grill.id, ada.id),
			user: remote.users.findProfile("ADA", null),
			nothing: undefined,
		});

		expect(trips.map((trip) => trip.calls.length)).toEqual([2]);
		expect(loaded).toEqual({ restaurant: expect.objectContaining({ name: "Bosporus Grill" }), user: expect.objectContaining({ username: "ada" }), nothing: undefined });
	});

	it("sends nothing for a load with no queries", async () => {
		const { db } = createTestDatabase();
		const { remote, trips } = connectOverClone(db);

		expect(await remote.load({ nothing: undefined })).toEqual({ nothing: undefined });
		expect(trips).toEqual([]);
	});

	it("refuses a query that asks for the viewer when no session was opened for it", async () => {
		const { db } = createTestDatabase();
		const { remote } = connectOverClone(db);

		await expect(remote.load(remote.reviews.listFeed("following", sessionViewer, firstPage))).rejects.toThrow(
			"reviews.listFeed asks for the viewer, but no session was opened for it.",
		);
	});
});

describe("A page", () => {
	it("opens its session in the same trip as its queries, which see the viewer of the session", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const { token } = await signIn(db, ada.id);
		const page = openPage(db, opening(token));

		const { feed } = await page.db.load({ feed: page.db.reviews.listFeed("following", page.db.viewer, firstPage) });

		expect(feed.feed).toBe("following");
		expect((await page.session())?.user.username).toBe("ada");
		expect(page.trips).toEqual([expect.objectContaining({ session: expect.objectContaining({ token }), calls: [expect.objectContaining({ method: "listFeed" })] })]);
	});

	it("has the session before the page goes on after its load", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const happened: string[] = [];
		const page = openPage(db, opening((await signIn(db, ada.id)).token, () => happened.push("opened")));

		await page.db.load({ profile: page.db.users.findProfile("ada", page.db.viewer) });
		happened.push("loaded");

		expect(happened).toEqual(["opened", "loaded"]);
	});

	it("shows its queries to a Visitor when the token opens no session", async () => {
		const { client, db } = createTestDatabase();
		insertUser(client, "ada");
		const page = openPage(db, opening("unknown.token"));

		const { feed } = await page.db.load({ feed: page.db.reviews.listFeed("following", page.db.viewer, firstPage) });

		expect(feed.feed).toBe("everyone");
		expect(await page.session()).toBeNull();
		expect(page.openedSession()).toBeNull();
	});

	it("asks nothing of the database for the session of a Visitor without a cookie", async () => {
		const { db } = createTestDatabase();
		const page = openPage(db, { opened: null });

		expect(await page.session()).toBeNull();
		const { feed } = await page.db.load({ feed: page.db.reviews.listFeed("following", page.db.viewer, firstPage) });

		expect(feed.feed).toBe("everyone");
		expect(page.trips).toEqual([{ calls: [expect.objectContaining({ method: "listFeed", args: ["following", null, firstPage] })], session: undefined }]);
	});

	it("gives a session it already has to its queries without opening it again", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const session = await signIn(db, ada.id);
		const page = openPage(db, { opened: session });

		const { feed } = await page.db.load({ feed: page.db.reviews.listFeed("following", page.db.viewer, firstPage) });

		expect(feed.feed).toBe("following");
		expect(page.trips).toEqual([expect.objectContaining({ session: undefined, calls: [expect.objectContaining({ args: ["following", ada.id, firstPage] })] })]);
	});

	it("opens the session alone when it is awaited before the load, and then cannot load again", async () => {
		const { client, db } = createTestDatabase();
		const ada = insertUser(client, "ada");
		const page = openPage(db, opening((await signIn(db, ada.id)).token));

		expect((await page.session())?.user.username).toBe("ada");

		await expect(page.db.load(page.db.users.findProfile("ada", page.db.viewer))).rejects.toThrow("A page loads from the database once.");
		expect(page.trips).toEqual([expect.objectContaining({ calls: [] })]);
	});

	it("loads from the database once", async () => {
		const { client, db } = createTestDatabase();
		insertUser(client, "ada");
		const page = openPage(db, { opened: null });

		await page.db.load(page.db.users.findProfile("ada", page.db.viewer));

		await expect(page.db.load(page.db.users.findProfile("ada", page.db.viewer))).rejects.toThrow("A page loads from the database once.");
	});

	it("tells where it loaded first when it loads again", async () => {
		const { client, db } = createTestDatabase();
		insertUser(client, "ada");
		const page = openPage(db, { opened: null });

		await page.db.load(page.db.users.findProfile("ada", page.db.viewer));
		const secondLoad = page.db.load(page.db.users.findProfile("ada", page.db.viewer));

		await expect(secondLoad).rejects.toMatchObject({ cause: expect.objectContaining({ stack: expect.stringContaining("remote.test.ts") }) });
	});

	it("can be awaited without being taken for a promise", async () => {
		const { db } = createTestDatabase();
		const page = openPage(db, { opened: null });

		expect(await Promise.resolve(page.db.users)).toBe(page.db.users);
	}, 1000);
});
