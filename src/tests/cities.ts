import { readFileSync } from "node:fs";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import { readCityList } from "@src/map/geonames";

// A few lines of the GeoNames files, zipped as GeoNames zips them.
export async function readSampleCityList() {
	const zip = new Uint8Array(readFileSync(new URL("./fixtures/cities.zip", import.meta.url)));
	return readCityList(zip, readFileSync(new URL("./fixtures/regions.txt", import.meta.url), "utf8"));
}

// Loads the sample as the CityList, the way an Admin's update does.
export async function loadSampleCityList(db: Database, adminId: number) {
	const update = await db.cities.requestUpdate(adminId);
	if (isProblem(update)) throw new Error(`The update was refused: ${update.problem}.`);
	await db.cities.finishUpdate(update.id, await readSampleCityList());
}
