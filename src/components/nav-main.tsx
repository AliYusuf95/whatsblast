import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Link } from '@tanstack/react-router';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

type NavSingleItem = {
  title: string;
  url: string;
  icon?: LucideIcon;
};

type NavGroupItem = {
  title: string;
  icon?: LucideIcon;
  items: NavSubItem[];
};

type NavSubItem = {
  title: string;
  url: string;
  isActive?: boolean;
};

export type NavItem = NavSingleItem | NavGroupItem;

function isNavSingleItem(item: NavItem): item is NavSingleItem {
  return !('items' in item) || item.items.length === 0;
}

function isNavGroupItem(item: NavItem): item is NavGroupItem {
  return 'items' in item && Array.isArray(item.items) && item.items.length > 0;
}

export function NavMain({ items }: { items: NavItem[] }) {
  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item) => {
          // If the item has no sub-items, render it as a regular menu item
          if (isNavSingleItem(item)) {
            return (
              <SidebarMenuItem key={item.title}>
                <Link
                  to={item.url}
                  className="flex items-center gap-2"
                  children={({ isActive }) => (
                    <SidebarMenuButton
                      tooltip={item.title}
                      className={cn(
                        isActive
                          ? 'border-b-2 border-b-muted-foreground/15 bg-muted-foreground/15 hover:bg-muted-foreground/15'
                          : '',
                      )}
                    >
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  )}
                />
              </SidebarMenuItem>
            );
          } else if (isNavGroupItem(item)) {
            const isActive = !!item.items.find((subItem) => {
              return subItem.isActive;
            });
            return (
              <Collapsible
                key={item.title}
                asChild
                defaultOpen={isActive}
                className="group/collapsible"
              >
                <SidebarMenuItem>
                  <CollapsibleTrigger asChild>
                    <SidebarMenuButton
                      tooltip={item.title}
                      className={
                        isActive
                          ? 'border-b-2 border-b-muted-foreground/15 bg-muted-foreground/15'
                          : 'group-data-[state=open]/collapsible:bg-muted-foreground/5'
                      }
                    >
                      {item.icon && <item.icon />}
                      <span>{item.title}</span>
                      <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                    </SidebarMenuButton>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenuSub>
                      {item.items?.map((subItem) => (
                        <SidebarMenuSubItem key={subItem.title}>
                          <SidebarMenuSubButton
                            asChild
                            className={subItem.isActive ? 'bg-muted-foreground/15' : ''}
                          >
                            <Link to={subItem.url}>
                              <span>{subItem.title}</span>
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                    </SidebarMenuSub>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </Collapsible>
            );
          }
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
