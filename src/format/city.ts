import { isShortSearch } from "@src/map/geonames";

// What a search that finds no City says. A search of one letter finds only the cities whose whole name it is.
export function noCityText(query: string): string {
	return isShortSearch(query) ? "Type at least two letters." : `No city starts with “${query}”.`;
}
