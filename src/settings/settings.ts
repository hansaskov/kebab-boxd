import { Bell, Download, MapPin, Shield, UserRound } from "@lucide/astro";
import type { AstroGlobal } from "astro";
import { can, type UserPermission } from "@src/auth/permissions";
import { settingsHref, signInHref } from "@src/hrefs";
import type { Database } from "@src/db";
import type { Loaded, Queries, RemoteDatabase } from "@src/db/remote";

// The settings of a User, each section on a page of its own, in the order the overview and the menu list them.
export const settingsSections = ["profile", "location", "notifications", "security", "data"] as const;

export type SettingsSection = (typeof settingsSections)[number];

export const settingsSectionDetails: Record<SettingsSection, { label: string; icon: typeof Bell; permission: UserPermission }> = {
	profile: { label: "Profile", icon: UserRound, permission: "user:edit-settings" },
	location: { label: "Location", icon: MapPin, permission: "user:edit-location" },
	notifications: { label: "Notifications", icon: Bell, permission: "user:edit-settings" },
	security: { label: "Security", icon: Shield, permission: "user:manage-sessions" },
	data: { label: "Your data", icon: Download, permission: "user:export-data" },
};

type Session = NonNullable<App.Locals["session"]>;
type User = NonNullable<Awaited<ReturnType<Database["users"]["findByUsername"]>>>;

export interface Settings {
	session: Session;
	// The User the settings belong to, who is someone else when an Admin opens them.
	user: User;
	// The sections the signed-in User may open, in the order of the overview.
	sections: { section: SettingsSection; label: string; icon: (typeof settingsSectionDetails)[SettingsSection]["icon"]; href: string }[];
}

// Opening the settings at all needs the permission to edit them. Each section may need more.
const overviewPermission: UserPermission = "user:edit-settings";

interface SettingsOptions<Q extends Queries> {
	// A page under a section gives its own address, so a Username in the wrong letter case leads to the same page.
	canonicalHref?: (username: string) => string;
	// What else the page shows, which comes in the same trip to the database as the User. Each query checks itself
	// whether the viewer may see it.
	load?: (db: RemoteDatabase, username: string, viewerId: number) => Q;
}

// The settings of the User in the path, for the overview when there is no section, or for a page of the section,
// with what else the page loaded. A visitor who is not signed in, or who may not open the page, gets the response
// that sends them away instead.
export async function openSettings<Q extends Queries = Record<never, never>>(
	Astro: AstroGlobal,
	section: SettingsSection | undefined,
	{ canonicalHref = (username) => settingsHref(username, section), load }: SettingsOptions<Q> = {},
): Promise<(Settings & { loaded: Loaded<Q> }) | Response> {
	const { username } = Astro.params;
	if (!username) return Astro.rewrite("/404");

	const { session, db } = Astro.locals;
	if (!session) return Astro.redirect(signInHref(Astro.url, "settings"));

	const { user, ...loaded } = await db.load({ ...load?.(db, username, session.user.id), user: db.users.findByUsername(username) });
	if (!user) return Astro.rewrite("/404");

	if (user.username !== username) return Astro.redirect(`${canonicalHref(user.username)}${Astro.url.search}`, 301);

	const permission = section ? settingsSectionDetails[section].permission : overviewPermission;
	if (!can(session.user, permission, user)) return Astro.rewrite("/403");

	const sections = settingsSections
		.filter((option) => can(session.user, settingsSectionDetails[option].permission, user))
		.map((option) => {
			const { label, icon } = settingsSectionDetails[option];
			return { section: option, label, icon, href: settingsHref(user.username, option) };
		});

	return { session, user, sections, loaded: loaded as Loaded<Q> };
}

// The other sections, which the browser may load before the User opens them.
export function otherSectionHrefs(settings: Settings, section: SettingsSection) {
	return settings.sections.filter((option) => option.section !== section).map((option) => option.href);
}
