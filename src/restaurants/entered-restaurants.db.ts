import type { Transaction } from "@src/db/client";
import * as s from "@src/db/schema";
import type { RestaurantStatus } from "@src/db/schema";
import { boundsAround, type Coordinates } from "@src/map/coordinates";
import type { Address } from "@src/restaurants/nominatim";

const duplicateDistanceMeters = 150;

const sameName = new Intl.Collator(undefined, { sensitivity: "accent" });

export interface FoundPlace extends Coordinates {
	name: string;
	googleMapsId?: string | null;
	osmId?: string | null;
}

export type Origin = { suggestedBy: number } | { citySearchId: number };

function statusOf(origin: Origin): RestaurantStatus {
	return "suggestedBy" in origin ? "pending" : "approved";
}

function locationIdsNear(tx: Transaction, place: Coordinates) {
	const { north, south, east, west } = boundsAround(place, duplicateDistanceMeters);
	return tx.query.locations
		.findMany({ columns: { id: true }, where: { latitude: { gte: south, lte: north }, longitude: { gte: west, lte: east } } })
		.sync()
		.map((location) => location.id);
}

export function findExisting(tx: Transaction, place: FoundPlace, statuses: readonly RestaurantStatus[]) {
	const { googleMapsId, osmId } = place;
	const nearIds = locationIdsNear(tx, place);
	const sameRestaurant = [
		...(googleMapsId ? [{ googleMapsId }] : []),
		...(osmId ? [{ osmId }] : []),
		...(nearIds.length > 0 ? [{ locationId: { in: nearIds } }] : []),
	];
	if (sameRestaurant.length === 0) return undefined;
	const restaurants = tx.query.restaurants
		.findMany({ columns: { id: true, name: true, googleMapsId: true, osmId: true }, where: { status: { in: [...statuses] }, OR: sameRestaurant } })
		.sync();
	return restaurants.find(
		(restaurant) =>
			(googleMapsId && restaurant.googleMapsId === googleMapsId) ||
			(osmId && restaurant.osmId === osmId) ||
			sameName.compare(restaurant.name, place.name) === 0,
	);
}

export function enterRestaurant(tx: Transaction, place: FoundPlace, address: Address, origin: Origin) {
	const { name, latitude, longitude, googleMapsId = null, osmId = null } = place;
	const location = tx.insert(s.locations).values({ ...address, latitude, longitude }).returning({ id: s.locations.id }).get();
	return tx
		.insert(s.restaurants)
		.values({ name, googleMapsId, osmId, locationId: location.id, status: statusOf(origin), ...origin })
		.returning({ id: s.restaurants.id })
		.get();
}
