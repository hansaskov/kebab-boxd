import type { Client } from "@src/db/client";
import { createAccountMutations } from "@src/db/mutations/accounts";
import { createFollowMutations } from "@src/db/mutations/follows";
import { createHistoryMutations } from "@src/db/mutations/history";
import { createRestaurantMutations } from "@src/db/mutations/restaurants";
import { createRetentionMutations } from "@src/db/mutations/retention";
import { createReviewMutations } from "@src/db/mutations/reviews";
import { createSessionMutations } from "@src/db/mutations/sessions";
import { createUserMutations } from "@src/db/mutations/users";
import { createHistoryQueries } from "@src/db/queries/history";
import { createPeopleQueries } from "@src/db/queries/people";
import { createPersonalDataQueries } from "@src/db/queries/personal-data";
import { createProfileQueries } from "@src/db/queries/profiles";
import { createRestaurantQueries } from "@src/db/queries/restaurants";
import { createReviewQueries } from "@src/db/queries/reviews";
import { createSessionQueries } from "@src/db/queries/sessions";
import { createUserQueries } from "@src/db/queries/users";
import type { PictureStore } from "@src/pictures/store";

// The pictures belong here because the rows that point to them are written here: whatever removes a
// picture from the database removes its file too.
export function createDatabase(client: Client, pictures: PictureStore) {
	return {
		pictures,
		queries: {
			history: createHistoryQueries(client),
			people: createPeopleQueries(client),
			personalData: createPersonalDataQueries(client),
			profiles: createProfileQueries(client),
			restaurants: createRestaurantQueries(client),
			reviews: createReviewQueries(client),
			sessions: createSessionQueries(client),
			users: createUserQueries(client),
		},
		mutations: {
			accounts: createAccountMutations(client),
			follows: createFollowMutations(client),
			history: createHistoryMutations(client),
			restaurants: createRestaurantMutations(client),
			retention: createRetentionMutations(client),
			reviews: createReviewMutations(client, pictures),
			sessions: createSessionMutations(client),
			users: createUserMutations(client, pictures),
		},
	};
}

export type Database = ReturnType<typeof createDatabase>;
