import { readFileSync } from "node:fs";
import type { Database } from "@src/db";
import { isProblem } from "@src/db/problem";
import type { CityGroupRow } from "@src/db/schema";
import { groupPrefix, readCityList, searchKey, type CityList } from "@src/cities/geonames";

// A few lines of the GeoNames files, zipped as GeoNames zips them.
export async function readSampleCityList() {
	const zip = new Uint8Array(readFileSync(new URL("./fixtures/cities.zip", import.meta.url)));
	return readCityList(zip, readFileSync(new URL("./fixtures/regions.txt", import.meta.url), "utf8"));
}

// Loads the list as the CityList, the way an Admin's update does.
export async function loadCityList(db: Database, adminId: number, list: CityList) {
	const update = await db.cities.requestUpdate(adminId);
	if (isProblem(update)) throw new Error(`The update was refused: ${update.problem}.`);
	await db.cities.finishUpdate(update.id, list);
}

export async function loadSampleCityList(db: Database, adminId: number) {
	await loadCityList(db, adminId, await readSampleCityList());
}

// A CityList of cities that share a name, the most populous first, which the sample has too few of.
export function namesakeCityList(name: string, count: number): CityList {
	const cities: CityGroupRow[] = Array.from({ length: count }, (_, index) => [
		index + 1,
		name,
		`Region ${index + 1}`,
		"US",
		30 + index,
		-90 - index,
		(count - index) * 1000,
		[searchKey(name)],
	]);
	return { groups: [{ prefix: groupPrefix(searchKey(name)), cities: JSON.stringify(cities) }], cityCount: count };
}
