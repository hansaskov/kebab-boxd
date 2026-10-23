import { userFilters, type UserListCriteria } from "@src/db/queries/users";
import { parseSearch } from "@src/validation/search";

export function parseUserListCriteria(params: URLSearchParams): UserListCriteria {
	return {
		search: parseSearch(params),
		filter: userFilters.find((option) => option === params.get("filter")) ?? "all",
	};
}
