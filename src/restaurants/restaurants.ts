export const restaurantSorts = ["top-rated", "popular", "newest"] as const;
export type RestaurantSort = (typeof restaurantSorts)[number];
