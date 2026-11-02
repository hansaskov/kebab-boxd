import { eq, isNotNull } from "drizzle-orm";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";

export function createAdminQueries(client: Client) {
	return {
		// The users by role and ban, and the restaurants by status, with one statement.
		async countOverview() {
			const counts = await client.query.users.findFirst({
				columns: {},
				extras: {
					all: client.$count(s.users),
					admin: client.$count(s.users, eq(s.users.role, "admin")),
					banned: client.$count(s.users, isNotNull(s.users.bannedAt)),
					approved: client.$count(s.restaurants, eq(s.restaurants.status, "approved")),
					pending: client.$count(s.restaurants, eq(s.restaurants.status, "pending")),
					rejected: client.$count(s.restaurants, eq(s.restaurants.status, "rejected")),
				},
			});
			if (!counts) throw new Error("The admin overview is only shown to a signed-in admin, so a user exists.");
			return counts;
		},
	};
}
