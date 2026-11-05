import { sql } from "drizzle-orm";
import type { Transaction } from "@src/db/client";
import * as s from "@src/db/schema";
import type { RestaurantStatus } from "@src/db/schema";
import { boundsAround, type Coordinates } from "@src/map/coordinates";
import type { Address } from "@src/map/nominatim";

// How a place that was found becomes a pending Restaurant, whether a User suggested it or a CitySearch found it.

// Two places with the same name this close to each other are taken to be the same restaurant.
const duplicateDistanceMeters = 150;

// The names are compared without case in every alphabet. SQLite's lower() only knows A to Z.
const sameName = new Intl.Collator(undefined, { sensitivity: "accent" });

// A place that may become a Restaurant, with its id at Google Maps or OpenStreetMap, where it was found.
export interface FoundPlace extends Coordinates {
	name: string;
	googleMapsId?: string | null;
	osmId?: string | null;
}

// Who entered the Restaurant: the User who suggested it, or the CitySearch that found it.
export type Origin = { suggestedBy: number } | { citySearchId: number };

// The Restaurant with one of the statuses that the place already is: the one with its id at Google Maps or
// OpenStreetMap, or one with its name close by.
export function findExisting(tx: Transaction, place: FoundPlace, statuses: readonly RestaurantStatus[]) {
	const { googleMapsId, osmId } = place;
	const { north, south, east, west } = boundsAround(place, duplicateDistanceMeters);
	const restaurants = tx.query.restaurants
		.findMany({
			columns: { id: true, name: true, googleMapsId: true, osmId: true },
			where: {
				status: { in: [...statuses] },
				OR: [
					...(googleMapsId ? [{ googleMapsId }] : []),
					...(osmId ? [{ osmId }] : []),
					{ location: { latitude: { gte: south, lte: north }, longitude: { gte: west, lte: east } } },
				],
			},
		})
		.sync();
	return restaurants.find(
		(restaurant) =>
			(googleMapsId && restaurant.googleMapsId === googleMapsId) ||
			(osmId && restaurant.osmId === osmId) ||
			sameName.compare(restaurant.name, place.name) === 0,
	);
}

export function insertPendingRestaurant(tx: Transaction, place: FoundPlace, address: Address, origin: Origin) {
	const { name, latitude, longitude, googleMapsId = null, osmId = null } = place;
	const location = tx.insert(s.locations).values({ ...address, latitude, longitude }).returning({ id: s.locations.id }).get();
	return tx
		.insert(s.restaurants)
		.values({ name, googleMapsId, osmId, locationId: location.id, status: "pending", ...origin })
		.returning({ id: s.restaurants.id })
		.get();
}

// How many Restaurants the CitySearch entered, whatever an Admin decided about them, as a column of a query on it.
export function enteredRestaurantCount(search: Pick<typeof s.citySearches, "id">) {
	return sql<number>`(select count(*) from ${s.restaurants} where ${s.restaurants.citySearchId} = ${search.id})`.mapWith(Number);
}
