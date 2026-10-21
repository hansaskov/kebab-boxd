import type { Client } from "@src/db/client";
import { createAccountMutations } from "@src/db/mutations/accounts";
import { createHistoryMutations } from "@src/db/mutations/history";
import { createSessionMutations } from "@src/db/mutations/sessions";
import { createSessionQueries } from "@src/db/queries/sessions";
import { createUserMutations } from "@src/db/mutations/users";
import { createUserQueries } from "@src/db/queries/users";

export function createDatabase(client: Client) {
	return {
		queries: {
			sessions: createSessionQueries(client),
			users: createUserQueries(client),
		},
		mutations: {
			accounts: createAccountMutations(client),
			history: createHistoryMutations(client),
			sessions: createSessionMutations(client),
			users: createUserMutations(client),
		},
	};
}

export type Database = ReturnType<typeof createDatabase>;
