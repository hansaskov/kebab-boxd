import { restaurantSorts, type RestaurantListCriteria } from "@src/db/queries/restaurants";
import { parseSearch } from "@src/validation/search";

export function parseRestaurantListCriteria(params: URLSearchParams): RestaurantListCriteria {
	return {
		search: parseSearch(params),
		sort: restaurantSorts.find((option) => option === params.get("sort")) ?? "top-rated",
	};
}
