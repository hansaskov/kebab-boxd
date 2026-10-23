export const profileTabs = ["reviews", "favorites", "bucket-list"] as const;
export type ProfileTab = (typeof profileTabs)[number];

export function parseProfileTab(params: URLSearchParams): ProfileTab {
	return profileTabs.find((tab) => tab === params.get("tab")) ?? "reviews";
}
