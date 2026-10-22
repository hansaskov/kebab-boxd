import { userFilters, type UserListCriteria } from "@src/db/queries/users";

export const searchMaxLength = 100;

export function parseUserListCriteria(params: URLSearchParams): UserListCriteria {
	return {
		search: (params.get("q") ?? "").trim().slice(0, searchMaxLength),
		filter: userFilters.find((option) => option === params.get("filter")) ?? "all",
	};
}
