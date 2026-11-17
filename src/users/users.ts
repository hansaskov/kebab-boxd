// What the pages share with users.db.ts, which the Web Worker cannot load.

// Admin is a role on a User, not a kind of user of its own.
export const roles = ["user", "admin"] as const;

export const pronouns = [
	"They / their",
	"He / his",
	"He / their",
	"She / her",
	"She / their",
	"Xe / xyr",
	"Ze / hir",
	"Ze /zir",
	"It / its",
] as const;

export const personSorts = ["most-reviews", "latest-review"] as const;
export type PersonSort = (typeof personSorts)[number];

export const userFilters = ["all", "admin", "banned"] as const;
export type UserFilter = (typeof userFilters)[number];
