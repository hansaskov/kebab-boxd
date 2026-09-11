import { Rss, Compass, SquarePen } from "@lucide/astro";

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
  ]