import type { Client } from "@src/db/client";
import { createAccountMutations } from "@src/db/mutations/accounts";
import { createFollowMutations } from "@src/db/mutations/follows";
import { createHistoryMutations } from "@src/db/mutations/history";
import { createRetentionMutations } from "@src/db/mutations/retention";
import { createSessionMutations } from "@src/db/mutations/sessions";
import { createHistoryQueries } from "@src/db/queries/history";
import { createPersonalDataQueries } from "@src/db/queries/personal-data";
import { createProfileQueries } from "@src/db/queries/profiles";
import { createSessionQueries } from "@src/db/queries/sessions";
import { createUserMutations } from "@src/db/mutations/users";
import { createUserQueries } from "@src/db/queries/users";

export function createDatabase(client: Client) {
	return {
		queries: {
			history: createHistoryQueries(client),
			personalData: createPersonalDataQueries(client),
			profiles: createProfileQueries(client),
			sessions: createSessionQueries(client),
			users: createUserQueries(client),
		},
		mutations: {
			accounts: createAccountMutations(client),
			follows: createFollowMutations(client),
			history: createHistoryMutations(client),
			retention: createRetentionMutations(client),
			sessions: createSessionMutations(client),
			users: createUserMutations(client),
		},
	};
}

export type Database = ReturnType<typeof createDatabase>;
