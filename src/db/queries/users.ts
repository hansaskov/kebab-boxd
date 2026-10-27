import type { Client } from "@src/db/client";
import { countRows } from "@src/db/subqueries";
import { containsText, hasUsername, type Filter } from "@src/db/filters";
import { cursorList } from "@src/db/pagination";
import type { PageRequest } from "@src/pagination";

export const userFilters = ["all", "admin", "banned"] as const;
export type UserFilter = (typeof userFilters)[number];

export interface UserListCriteria {
	search: string;
	filter: UserFilter;
}

export const userFilterWhere = {
	all: {},
	admin: { role: "admin" },
	banned: { bannedAt: { isNotNull: true } },
} satisfies Record<UserFilter, Filter<"users">>;

function matching({ search, filter }: UserListCriteria): Filter<"users"> {
	if (!search) return userFilterWhere[filter];

	return {
		AND: [
			userFilterWhere[filter],
			{
				OR: [
					{ RAW: (user) => containsText(user.username, search) },
					{ RAW: (user) => containsText(user.fullname, search) },
					{ RAW: (user) => containsText(user.email, search) },
				],
			},
		],
	};
}

const pages = cursorList("users", ["id"], "desc");

export function createUserQueries(client: Client) {
	return {
		async findByUsername(username: string) {
			return client.query.users.findFirst({ with: { profilePicture: { columns: { url: true } } }, where: hasUsername(username) });
		},

		// Each row carries the number of users that match, which SQLite counts once for the whole statement.
		async list(criteria: UserListCriteria, page: PageRequest) {
			const where = matching(criteria);
			const users = await pages(page, (seek) =>
				client.query.users.findMany({
					columns: { id: true, fullname: true, username: true, email: true, role: true, bannedAt: true, createdAt: true },
					extras: { total: () => countRows(client, "users", where) },
					...seek(where),
				}),
			);
			return { ...users, total: users.items[0]?.total ?? 0 };
		},
	};
}
