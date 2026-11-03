import { Bell, Download, MapPin, Shield, UserRound } from "@lucide/astro";
import type { UserPermission } from "@src/auth/permissions";

// The settings of a User, each section on a page of its own, in the order the overview and the menu list them.
export const settingsSections = ["profile", "location", "notifications", "security", "data"] as const;

export type SettingsSection = (typeof settingsSections)[number];

export const settingsSectionDetails: Record<SettingsSection, { label: string; icon: typeof Bell; permission: UserPermission }> = {
	profile: { label: "Profile", icon: UserRound, permission: "user:edit-settings" },
	location: { label: "Location", icon: MapPin, permission: "user:edit-settings" },
	notifications: { label: "Notifications", icon: Bell, permission: "user:edit-settings" },
	security: { label: "Security", icon: Shield, permission: "user:manage-sessions" },
	data: { label: "Your data", icon: Download, permission: "user:export-data" },
};
