import { sql } from "drizzle-orm";
import type { Client } from "@src/db/client";

export function createAccountQueries(client: Client) {
	const withUser = client.query.accounts
		.findFirst({
			with: { user: true },
			where: { providerId: sql.placeholder("providerId"), accountId: sql.placeholder("accountId") },
		})
		.prepare();

	return {
		/** Finds an account, and the user it belongs to, by the Provider and the Provider's subject id. */
		async findWithUser(providerId: string, accountId: string) {
			return withUser.execute({ providerId, accountId });
		},
	};
}
