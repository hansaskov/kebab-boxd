import type { Tab } from "@src/components/TabNav.astro";

const adminPages = [
	{ label: "Overview", href: "/admin" },
	{ label: "Users", href: "/admin/users" },
	{ label: "Restaurants", href: "/admin/restaurants" },
	{ label: "Cities", href: "/admin/cities" },
];

export function adminTabs(pathname: string): Tab[] {
	return adminPages.map(({ label, href }) => ({
		label,
		href,
		current: href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`),
	}));
}
