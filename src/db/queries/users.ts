import { and, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { Client } from "@src/db/client";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

export const userFilters = ["all", "admin", "banned"] as const;
export type UserFilter = (typeof userFilters)[number];

export interface UserListCriteria {
	search: string;
	filter: UserFilter;
}

type Users = typeof s.users;

const userFilterWhere = {
	all: () => undefined,
	admin: (user) => eq(user.role, "admin"),
	banned: (user) => isNotNull(user.bannedAt),
} satisfies Record<UserFilter, (user: Users) => SQL | undefined>;

// Written as SQL, so that the list and its count use the same condition.
function matching({ search, filter }: UserListCriteria, user: Users) {
	return and(
		userFilterWhere[filter](user),
		search
			? or(
					sql`instr(lower(${user.username}), lower(${search})) > 0`,
					sql`instr(lower(${user.fullname}), lower(${search})) > 0`,
					sql`instr(lower(${user.email}), lower(${search})) > 0`,
				)
			: undefined,
	);
}

const pages = cursorList("users", ["id"], "desc");

export function createUserQueries(client: Client) {
	return {
		async findByUsername(username: string) {
			return client.query.users.findFirst({ with: { profilePicture: { columns: { url: true } } }, where: { username: username.toLowerCase() } });
		},

		// Each row carries the number of users that match, which SQLite counts once for the whole statement.
		async list(criteria: UserListCriteria, page: PageRequest) {
			const users = await pages(page, (seek) =>
				client.query.users.findMany({
					columns: { id: true, fullname: true, username: true, email: true, role: true, bannedAt: true, createdAt: true },
					extras: { total: client.$count(s.users, matching(criteria, s.users)) },
					...seek({ RAW: (user) => matching(criteria, user) ?? sql`true` }),
				}),
			);
			return { ...users, total: users.items[0]?.total ?? 0 };
		},
	};
}
