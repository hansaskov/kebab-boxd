import { readFileSync } from "node:fs";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import { readCityList, type CityList } from "@src/cities/geonames";

// A few lines of the GeoNames files, zipped as GeoNames zips them.
async function readSampleCityList() {
	const zip = new Uint8Array(readFileSync(new URL("./fixtures/cities.zip", import.meta.url)));
	return readCityList(zip, readFileSync(new URL("./fixtures/regions.txt", import.meta.url), "utf8"));
}

// Loads the list as the CityList, the way an Admin's update does.
async function loadCityList(db: Database, adminId: number, list: CityList) {
	const update = await db.cities.requestUpdate(adminId);
	if (isProblem(update)) throw new Error(`The update was refused: ${update.problem}.`);
	await db.cities.finishUpdate(update.id, list);
}

export async function loadSampleCityList(db: Database, adminId: number) {
	await loadCityList(db, adminId, await readSampleCityList());
}

