import { Bell, Download, MapPin, Shield, UserRound } from "@lucide/astro";
import type { AstroGlobal } from "astro";
import { can, type UserPermission } from "@src/auth/permissions";
import { refusalPage, settingsHref, signInHref } from "@src/hrefs";
import { isProblem, type Refused } from "@src/db/problem";
import type { SessionWithUser } from "@src/auth/sessions.db";
import type { Database } from "@src/db";
import type { Loaded, PageDatabase, Queries } from "@src/db/remote";

export const settingsSections = ["profile", "location", "notifications", "security", "data"] as const;

export type SettingsSection = (typeof settingsSections)[number];

export const settingsSectionDetails: Record<SettingsSection, { label: string; icon: typeof Bell; permission: UserPermission }> = {
	profile: { label: "Profile", icon: UserRound, permission: "user:edit-settings" },
	location: { label: "Location", icon: MapPin, permission: "user:edit-location" },
	notifications: { label: "Notifications", icon: Bell, permission: "user:edit-settings" },
	security: { label: "Security", icon: Shield, permission: "user:manage-sessions" },
	data: { label: "Your data", icon: Download, permission: "user:export-data" },
};

type User = Exclude<Awaited<ReturnType<Database["users"]["findAllowed"]>>, Refused | undefined>;

export interface Settings {
	session: SessionWithUser;
	user: User;
	sections: { section: SettingsSection; label: string; icon: (typeof settingsSectionDetails)[SettingsSection]["icon"]; href: string }[];
}

const overviewPermission: UserPermission = "user:edit-settings";

interface SettingsOptions<Q extends Queries> {
	canonicalHref?: (username: string) => string;
	load?: (db: PageDatabase, username: string) => Q;
}

export async function openSettings<Q extends Queries = Record<never, never>>(
	Astro: AstroGlobal,
	section: SettingsSection | undefined,
	{ canonicalHref = (username) => settingsHref(username, section), load }: SettingsOptions<Q> = {},
): Promise<(Settings & { loaded: Loaded<Q> }) | Response> {
	const { username } = Astro.params;
	if (!username) return Astro.rewrite("/404");

	const { db } = Astro.locals;
	const permission = section ? settingsSectionDetails[section].permission : overviewPermission;
	const { user, ...loaded } = await db.load({ ...load?.(db, username), user: db.users.findAllowed(username, db.viewer, permission) });
	const session = await Astro.locals.session();
	if (!session) return Astro.redirect(signInHref(Astro.url, "settings"));
	if (isProblem(user)) return Astro.rewrite(refusalPage[user.problem]);

	if (user.username !== username) return Astro.redirect(`${canonicalHref(user.username)}${Astro.url.search}`, 301);

	const sections = settingsSections
		.filter((option) => can(session.user, settingsSectionDetails[option].permission, user))
		.map((option) => {
			const { label, icon } = settingsSectionDetails[option];
			return { section: option, label, icon, href: settingsHref(user.username, option) };
		});

	return { session, user, sections, loaded: loaded as Loaded<Q> };
}

export function otherSectionHrefs(settings: Settings, section: SettingsSection) {
	return settings.sections.filter((option) => option.section !== section).map((option) => option.href);
}
