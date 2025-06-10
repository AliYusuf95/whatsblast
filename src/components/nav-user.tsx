'use client';

import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  SettingsIcon,
  Sparkles,
} from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { Link } from '@tanstack/react-router';
import { UserButton, UserView } from '@daveyplate/better-auth-ui';
import { Route as signOut } from '../routes/auth/sign-out';
import { Route as settings } from '../routes/_app/settings';
import type { User } from '@/server/auth';

interface NavUserProps {
  user?: User;
}

export function NavUser({ user }: NavUserProps) {
  const { isMobile } = useSidebar();

  if (!user) {
    return null;
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="bg-muted-foreground/15 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              variant="outline"
            >
              <UserView
                user={user}
                isPending={!user}
                classNames={{
                  base: 'overflow-visible',
                }}
              />
              <span />
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <UserView user={user} isPending={!user} className="px-1 py-1.5" />
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <Link to={settings.to}>
                <DropdownMenuItem>
                  <SettingsIcon />
                  Settings
                </DropdownMenuItem>
              </Link>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <Link to={signOut.to}>
              <DropdownMenuItem>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </Link>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
