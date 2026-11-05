import type { AstroGlobal } from "astro";
import { can, type UserPermission } from "@src/auth/permissions";
import { settingsSectionDetails, settingsSections, type SettingsSection } from "@src/data/settings-sections";
import { settingsHref, signInHref } from "@src/hrefs";

type Session = NonNullable<App.Locals["session"]>;
type User = NonNullable<Awaited<ReturnType<App.Locals["db"]["users"]["findByUsername"]>>>;

export interface Settings {
	session: Session;
	// The User the settings belong to, who is someone else when an Admin opens them.
	user: User;
	// The sections the signed-in User may open, in the order of the overview.
	sections: { section: SettingsSection; label: string; icon: (typeof settingsSectionDetails)[SettingsSection]["icon"]; href: string }[];
}

// Opening the settings at all needs the permission to edit them. Each section may need more.
const overviewPermission: UserPermission = "user:edit-settings";

// The settings of the User in the path, for the overview when there is no section, or for a page of the section.
// A visitor who is not signed in, or who may not open the page, gets the response that sends them away instead.
// A page under a section gives its own address, so a Username in the wrong letter case leads to the same page.
export async function openSettings(
	Astro: AstroGlobal,
	section: SettingsSection | undefined,
	canonicalHref: (username: string) => string = (username) => settingsHref(username, section),
): Promise<Settings | Response> {
	const { username } = Astro.params;
	if (!username) return Astro.rewrite("/404");

	const { session } = Astro.locals;
	if (!session) return Astro.redirect(signInHref(Astro.url, "settings"));

	const user = await Astro.locals.db.users.findByUsername(username);
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

	return { session, user, sections };
}

// The other sections, which the browser may load before the User opens them.
export function otherSectionHrefs(settings: Settings, section: SettingsSection) {
	return settings.sections.filter((option) => option.section !== section).map((option) => option.href);
}
