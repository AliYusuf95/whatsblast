import { Link } from '@tanstack/react-router';

import { NavMain, type NavItem } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

import logoPath from '@/logo.svg';
import type { User } from '@/server/auth';

type SidebarProps = React.ComponentProps<typeof Sidebar> & {
  homeLink: string;
  user?: User;
  navItems: NavItem[];
};

export function AppSidebar({ homeLink, user, navItems, ...props }: SidebarProps) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
              <Link to={homeLink}>
                <img src={logoPath} alt="Logo" className="!size-5" />
                <span className="text-base font-semibold">WhatsBlast</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
