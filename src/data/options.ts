// The choices the pages offer and the database follows, such as the orders a list can be sorted in. They live apart
// from the code of the database, which needs Drizzle and the whole schema: the pages import them too, and the Web
// Worker would otherwise load all of that each time it starts.

export const roles = ["user", "admin"] as const;

export const feeds = ["following", "everyone"] as const;
export type Feed = (typeof feeds)[number];

export const restaurantSorts = ["top-rated", "popular", "newest"] as const;
export type RestaurantSort = (typeof restaurantSorts)[number];

export const personSorts = ["most-reviews", "latest-review"] as const;
export type PersonSort = (typeof personSorts)[number];

export const userFilters = ["all", "admin", "banned"] as const;
export type UserFilter = (typeof userFilters)[number];
