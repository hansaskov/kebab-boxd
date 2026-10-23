import { Rss, Compass, SquarePen, UserRoundCog, Shield, Bell, MonitorSmartphone, TriangleAlert, LayoutDashboard, Users, Download } from "@lucide/astro";
import { settingsHref } from "@src/hrefs";

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

export function settingsSidebarMenuSections(username: string): SidebarMenuSection[] {
  const href = settingsHref(username);

  return defaultSidebarMenuSections.concat([
    {
      title: "Settings",
      items: [
        { name: "Account", href: `${href}#account`, icon: UserRoundCog },
        { name: "Security", href: `${href}#security`, icon: Shield },
        { name: "Devices", href: `${href}#devices`, icon: MonitorSmartphone },
        { name: "Notifications", href: `${href}#notifications`, icon: Bell },
        { name: "Your data", href: `${href}#your-data`, icon: Download },
        { name: "Danger zone", href: `${href}#danger-zone`, icon: TriangleAlert },
      ],
    },
  ]);
}

export function adminSidebarMenuSections(): SidebarMenuSection[] {
  return defaultSidebarMenuSections.concat([
    {
      title: "Admin",
      items: [
        { name: "Overview", href: "/admin", icon: LayoutDashboard },
        { name: "Users", href: "/admin/users", icon: Users },
      ],
    },
  ]);
}
