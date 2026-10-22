import { userFilters, type UserListCriteria } from "@src/db/queries/users";

export const searchMaxLength = 100;

/**
 * Reads `?q=<text>`, which searches usernames, names and emails, and `?filter=<group>`, which
 * narrows the list to one group. Values that are not on offer list every user.
 */
export function parseUserListCriteria(params: URLSearchParams): UserListCriteria {
	return {
		search: (params.get("q") ?? "").trim().slice(0, searchMaxLength),
		filter: userFilters.find((option) => option === params.get("filter")) ?? "all",
	};
}
