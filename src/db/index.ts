import { createAccounts } from "@src/auth/accounts.db";
import { createCities } from "@src/cities/cities.db";
import { createCitySearches } from "@src/cities/city-searches.db";
import type { Client } from "@src/db/client";
import { createCollections } from "@src/restaurants/collections.db";
import { createFollows } from "@src/follows/follows.db";
import { createHistory } from "@src/auth/history.db";
import { createNotifications } from "@src/notifications/notifications.db";
import { createPersonalData } from "@src/privacy/personal-data.db";
import { createRestaurants } from "@src/restaurants/restaurants.db";
import { createRetention } from "@src/privacy/retention.db";
import { createReviews } from "@src/reviews/reviews.db";
import { createSessions } from "@src/auth/sessions.db";
import { createSuggestionQueue } from "@src/restaurants/suggestion-queue.db";
import { createUsers } from "@src/users/users.db";
import type { PictureStore } from "@src/pictures/store";

// Each concept of CONTEXT.md has a .db.ts module in the folder of its feature, which both reads and writes it.
// The rules that more than one of them needs live beside this file, in visibility.ts, authorize.ts and
// cached-stats.ts.
//
// The pictures belong here because the rows that point to them are written here: whatever removes a
// picture from the database removes its file too.
//
// Writes that leave work for later, such as a link to look up, wake the Durable Object, which sleeps while no
// work is waiting. onWork is how it listens, and only works inside it: a function cannot cross RPC.
export function createDatabase(client: Client, pictures: PictureStore) {
	const workListeners = new Set<() => void>();
	const wake = () => {
		for (const listener of workListeners) listener();
	};

	return {
		pictures,
		onWork(listener: () => void) {
			workListeners.add(listener);
			return () => workListeners.delete(listener);
		},
		accounts: createAccounts(client),
		cities: createCities(client, wake),
		citySearches: createCitySearches(client, wake),
		collections: createCollections(client),
		follows: createFollows(client),
		history: createHistory(client),
		notifications: createNotifications(client),
		personalData: createPersonalData(client),
		restaurants: createRestaurants(client),
		retention: createRetention(client),
		reviews: createReviews(client, pictures),
		sessions: createSessions(client),
		suggestionQueue: createSuggestionQueue(client, wake),
		users: createUsers(client, pictures),
	};
}

export type Database = ReturnType<typeof createDatabase>;
