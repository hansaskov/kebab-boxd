import type { Client } from "@src/db/client";
import { restaurantStatusWhere } from "@src/db/queries/restaurants";
import { userFilterWhere } from "@src/db/queries/users";
import { countsOf, selectCounts } from "@src/db/subqueries";

export function createAdminQueries(client: Client) {
	return {
		// The users by role and ban, and the restaurants by status, with one statement.
		async countOverview() {
			return selectCounts(client, {
				...countsOf(client, "users", userFilterWhere),
				...countsOf(client, "restaurants", restaurantStatusWhere),
			});
		},
	};
}
