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

/** The default menu plus links to each part of a user's settings page. */
export function settingsSidebarMenuSections(username: string): SidebarMenuSection[] {
  const settingsHref = `/${encodeURIComponent(username)}/settings`;

  return defaultSidebarMenuSections.concat([
    {
      title: "Settings",
      items: [
        { name: "Account", href: `${settingsHref}#account`, icon: UserRoundCog },
        { name: "Security", href: `${settingsHref}#security`, icon: Shield },
        { name: "Devices", href: `${settingsHref}#devices`, icon: MonitorSmartphone },
        { name: "Notifications", href: `${settingsHref}#notifications`, icon: Bell },
        { name: "Danger zone", href: `${settingsHref}#danger-zone`, icon: TriangleAlert },
      ],
    },
  ]);
}
