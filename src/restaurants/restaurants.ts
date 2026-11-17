// What the pages share with restaurants.db.ts, which the Web Worker cannot load.

export const restaurantSorts = ["top-rated", "popular", "newest"] as const;
export type RestaurantSort = (typeof restaurantSorts)[number];
