import { describe, expect, it } from "vitest";
import { searchKey } from "@src/map/geonames";
import { loadSampleCityList, readSampleCityList } from "@src/tests/cities";
import { createTestDatabase, insertUser } from "@src/tests/database";

describe("the CityList", () => {
	it("is read from the GeoNames files, without the places that are abandoned or historical", async () => {
		const list = await readSampleCityList();

		expect(list.cityCount).toBe(8);
		expect(list.groups.flatMap((group) => (JSON.parse(group.cities) as [number, string][]).map((city) => city[1]))).not.toContain("Hagen");
	});

	it("finds a City by the start of its name, without regard to letter case or accents, the most populous first", async () => {
		const { client, db } = createTestDatabase();
		await loadSampleCityList(db, insertUser(client, "root_admin", "admin").id);
		const find = async (query: string) => (await db.cities.search(query, 10)).map((city) => `${city.name}, ${city.region ?? "-"}, ${city.countryCode}`);

		expect({
			paris: await find("pari"),
			zurich: await find("ZURICH"),
			ascii: await find("zuerich"),
			koge: await find("koge"),
			arhus: await find("Århus"),
			apostrophe: await find("'s-grav"),
			none: await find("odensee"),
			empty: await find(" "),
		}).toEqual({
			paris: ["Paris, Île-de-France, FR", "Paris, Texas, US"],
			zurich: ["Zürich, Zurich, CH"],
			ascii: ["Zürich, Zurich, CH"],
			koge: ["Køge, -, DK"],
			arhus: ["Århus, -, DK"],
			apostrophe: ["'s-Gravenwezel, Flanders, BE"],
			none: [],
			empty: [],
		});
	});

	it("is searched by letters of their own written as the letters they sound like", () => {
		expect(["Øresund", "Æbeltoft", "Straße", "Łódź", "Ísafjörður"].map(searchKey)).toEqual(["oresund", "aebeltoft", "strasse", "lodz", "isafjordur"]);
	});

	it("is updated only by an Admin, once at a time, and stays in use when an update fails", async () => {
		const { client, db } = createTestDatabase();
		const admin = insertUser(client, "root_admin", "admin");
		const ada = insertUser(client, "ada");

		expect(await db.cities.requestUpdate(ada.id)).toEqual({ problem: "forbidden", permission: "city-list:update" });
		expect(await db.cities.status()).toEqual({ current: undefined, isUpdating: false, lastFailure: undefined });

		await loadSampleCityList(db, admin.id);
		const first = await db.cities.requestUpdate(admin.id);
		const second = await db.cities.requestUpdate(admin.id);

		expect(second).toEqual(first);
		expect(await db.cities.status()).toMatchObject({ current: { cityCount: 8 }, isUpdating: true });

		if ("id" in first) await db.cities.failUpdate(first.id, "GeoNames answered 503");

		expect(await db.cities.status()).toMatchObject({ current: { cityCount: 8 }, isUpdating: false, lastFailure: { error: "GeoNames answered 503" } });
		expect(await db.cities.search("odense", 10)).toHaveLength(1);
	});
});
