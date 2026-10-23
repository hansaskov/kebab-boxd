import { and, count, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList, type Seek } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

export const userFilters = ["all", "admin", "banned"] as const;
export type UserFilter = (typeof userFilters)[number];

export interface UserListCriteria {
	search: string;
	filter: UserFilter;
}

const filterConditions: Record<UserFilter, SQL | undefined> = {
	all: undefined,
	admin: eq(s.users.role, "admin"),
	banned: isNotNull(s.users.bannedAt),
};

function containsPattern(search: string) {
	return `%${search.replace(/[\\%_]/g, "\\$&")}%`;
}

function matchesSearch() {
	const pattern = sql.placeholder("pattern");
	return or(
		sql`${s.users.username} like ${pattern} escape '\\'`,
		sql`${s.users.fullname} like ${pattern} escape '\\'`,
		sql`${s.users.email} like ${pattern} escape '\\'`,
	);
}

function forEachFilter<T>(build: (filter: UserFilter) => T): Record<UserFilter, T> {
	return Object.fromEntries(userFilters.map((filter) => [filter, build(filter)])) as Record<UserFilter, T>;
}

function countWhere(condition: SQL | undefined) {
	return condition ? sql<number>`count(*) filter (where ${condition})`.mapWith(Number) : count();
}

function prepareUserList(client: Client, filter: UserFilter, seek: Seek) {
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
		.where(and(matchesSearch(), filterConditions[filter], seek.where))
		.orderBy(...seek.orderBy)
		.limit(seek.limit)
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

	const lists = forEachFilter((filter) =>
		cursorList(s.users, ["id"], "desc", (seek) => prepareUserList(client, filter, seek)),
	);
	const counts = forEachFilter((filter) => prepareUserCount(client, filter));

	const totals = client
		.select(forEachFilter((filter) => countWhere(filterConditions[filter])))
		.from(s.users)
		.prepare();

	return {
		async findByUsername(username: string) {
			return byUsername.execute({ username: username.toLowerCase() });
		},

		async list({ search, filter }: UserListCriteria, page: PageRequest) {
			const pattern = containsPattern(search);
			const users = await lists[filter](page, { pattern });
			return { ...users, total: counts[filter].get({ pattern })?.count ?? 0 };
		},

		async countByFilter(): Promise<Record<UserFilter, number>> {
			return totals.get() ?? forEachFilter(() => 0);
		},
	};
}
