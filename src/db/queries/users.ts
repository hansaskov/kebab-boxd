import { and, count, desc, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Client } from "@src/db/client";
import * as s from "@src/db/schema";

/** The groups of users the admin console can list. */
export const userFilters = ["all", "admin", "banned"] as const;
export type UserFilter = (typeof userFilters)[number];

export interface UserListPage {
	/** Matched anywhere in the username, full name or email. Empty matches every user. */
	search: string;
	filter: UserFilter;
	limit: number;
	offset: number;
}

const filterConditions: Record<UserFilter, SQL | undefined> = {
	all: undefined,
	admin: eq(s.users.role, "admin"),
	banned: isNotNull(s.users.bannedAt),
};

/** A LIKE pattern that finds the search text anywhere, with its own % and _ taken literally. */
function containsPattern(search: string) {
	return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

function matchesSearch() {
	const pattern = sql.placeholder("pattern");
	// SQLite's LIKE ignores the case of ASCII letters.
	return or(
		sql`${s.users.username} like ${pattern} escape '\\'`,
		sql`${s.users.fullname} like ${pattern} escape '\\'`,
		sql`${s.users.email} like ${pattern} escape '\\'`,
	);
}

/** Builds one value for each filter, so a new filter only has to be added to `filterConditions`. */
function forEachFilter<T>(build: (filter: UserFilter) => T): Record<UserFilter, T> {
	return Object.fromEntries(userFilters.map((filter) => [filter, build(filter)])) as Record<UserFilter, T>;
}

/** Counts the rows that meet the condition, or every row when there is none. */
function countWhere(condition: SQL | undefined) {
	return condition ? sql<number>`count(*) filter (where ${condition})`.mapWith(Number) : count();
}

function prepareUserList(client: Client, filter: UserFilter) {
	return client
		.select({
			id: s.users.id,
			fullname: s.users.fullname,
			username: s.users.username,
			email: s.users.email,
			role: s.users.role,
			bannedAt: s.users.bannedAt,
			createdAt: s.users.createdAt,
		})
		.from(s.users)
		.where(and(matchesSearch(), filterConditions[filter]))
		// Newest first, so new accounts are easy to look over.
		.orderBy(desc(s.users.createdAt), desc(s.users.id))
		.limit(sql.placeholder("limit"))
		.offset(sql.placeholder("offset"))
		.prepare();
}

function prepareUserCount(client: Client, filter: UserFilter) {
	return client
		.select({ count: count() })
		.from(s.users)
		.where(and(matchesSearch(), filterConditions[filter]))
		.prepare();
}

export function createUserQueries(client: Client) {
	const byUsername = client.query.users
		.findFirst({ where: { username: sql.placeholder("username") } })
		.prepare();

	const lists = forEachFilter((filter) => prepareUserList(client, filter));
	const counts = forEachFilter((filter) => prepareUserCount(client, filter));

	const totals = client
		.select(forEachFilter((filter) => countWhere(filterConditions[filter])))
		.from(s.users)
		.prepare();

	return {
		/** Finds the user with exactly this username. Usernames are stored in lowercase. */
		async findByUsername(username: string) {
			return byUsername.execute({ username });
		},

		/** One page of the users that match the search and filter, and how many match in all. */
		async list({ search, filter, limit, offset }: UserListPage) {
			const pattern = containsPattern(search);
			return {
				users: lists[filter].all({ pattern, limit, offset }),
				total: counts[filter].get({ pattern })?.count ?? 0,
			};
		},

		/** How many users there are in each group the admin console lists. */
		async countByFilter(): Promise<Record<UserFilter, number>> {
			return totals.get() ?? forEachFilter(() => 0);
		},
	};
}
