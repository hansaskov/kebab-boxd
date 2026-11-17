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
