import { createAccounts } from "@src/db/accounts";
import { createCities } from "@src/db/cities";
import { createCitySearches } from "@src/db/city-searches";
import type { Client } from "@src/db/client";
import { createCollections } from "@src/db/collections";
import { createFollows } from "@src/db/follows";
import { createHistory } from "@src/db/history";
import { createNotifications } from "@src/db/notifications";
import { createPersonalData } from "@src/db/personal-data";
import { createRestaurants } from "@src/db/restaurants";
import { createRetention } from "@src/db/retention";
import { createReviews } from "@src/db/reviews";
import { createSessions } from "@src/db/sessions";
import { createSuggestionQueue } from "@src/db/suggestion-queue";
import { createUsers } from "@src/db/users";
import type { PictureStore } from "@src/pictures/store";

// One module for each concept of CONTEXT.md, which both reads and writes it. The rules that more than one of
// them needs live in visibility.ts, authorize.ts and cached-stats.ts.
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
