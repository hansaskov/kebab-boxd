import type { Client } from "@src/db/client";
import { countRows } from "@src/db/count";
import { containsText, hasUsername, type Filter } from "@src/db/filters";
import { cursorList } from "@src/db/pagination";
import * as s from "@src/db/schema";
import type { PageRequest } from "@src/pagination";

export const userFilters = ["all", "admin", "banned"] as const;
export type UserFilter = (typeof userFilters)[number];

export interface UserListCriteria {
	search: string;
	filter: UserFilter;
}

const byFilter = {
	all: {},
	admin: { role: "admin" },
	banned: { bannedAt: { isNotNull: true } },
} satisfies Record<UserFilter, Filter<"users">>;

function matching({ search, filter }: UserListCriteria): Filter<"users"> {
	if (!search) return byFilter[filter];

	return {
		AND: [
			byFilter[filter],
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

const pages = cursorList(s.users, ["id"], "desc");

export function createUserQueries(client: Client) {
	return {
		async findByUsername(username: string) {
			return client.query.users.findFirst({ where: hasUsername(username) });
		},

		async list(criteria: UserListCriteria, page: PageRequest) {
			const where = matching(criteria);
			const [users, total] = await Promise.all([
				pages(page, (seek) =>
					client.query.users.findMany({
						columns: { id: true, fullname: true, username: true, email: true, role: true, bannedAt: true, createdAt: true },
						where: { AND: [where, seek.where] },
						orderBy: seek.orderBy,
						limit: seek.limit,
					}),
				),
				countRows(client, "users", where),
			]);
			return { ...users, total };
		},

		async countByFilter(): Promise<Record<UserFilter, number>> {
			const [all, admin, banned] = await Promise.all([
				countRows(client, "users", byFilter.all),
				countRows(client, "users", byFilter.admin),
				countRows(client, "users", byFilter.banned),
			]);
			return { all, admin, banned };
		},
	};
}
