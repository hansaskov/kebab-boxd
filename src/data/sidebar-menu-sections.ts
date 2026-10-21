import { Rss, Compass, SquarePen, UserRoundCog, Shield, Bell, MonitorSmartphone, TriangleAlert } from "@lucide/astro";

export type SidebarMenuItem = {
  name: string;
  href: string;
  icon: typeof Rss;
};

export type SidebarMenuSection = {
  title: string;
  items: SidebarMenuItem[];
};

export const defaultSidebarMenuSections: SidebarMenuSection[] = [
    {
      title: "Discover",
      items: [
        { 
          name: "Feed", 
          href: "/", 
          icon: Rss },
        {
          name: "Explore",
          href: "/explore",
          icon: Compass,
        },
      ],
    },
    {
      title: "You",
      items: [
        {
          name: "Reviews",
          href: "/reviews",
          icon: SquarePen,
        },
      ],
    },
  ];

/**
 * The default menu plus links to each part of a user's settings page. The links to the parts
 * about sessions are left out for someone who may not manage them.
 */
export function settingsSidebarMenuSections(
  username: string,
  { canManageSessions }: { canManageSessions: boolean },
): SidebarMenuSection[] {
  const settingsHref = `/${encodeURIComponent(username)}/settings`;
  const items: (SidebarMenuItem | false)[] = [
    { name: "Account", href: `${settingsHref}#account`, icon: UserRoundCog },
    { name: "Security", href: `${settingsHref}#security`, icon: Shield },
    canManageSessions && { name: "Devices", href: `${settingsHref}#devices`, icon: MonitorSmartphone },
    { name: "Notifications", href: `${settingsHref}#notifications`, icon: Bell },
    canManageSessions && { name: "Danger zone", href: `${settingsHref}#danger-zone`, icon: TriangleAlert },
  ];

  return defaultSidebarMenuSections.concat([
    {
      title: "Settings",
      items: items.filter((item) => item !== false),
    },
  ]);
}
