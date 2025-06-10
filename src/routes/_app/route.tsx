import { AppSidebar } from '@/components/app-sidebar';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { createFileRoute, Outlet, redirect, useRouterState } from '@tanstack/react-router';
import { SettingsIcon, Smartphone, Send, Clock, LayoutDashboard } from 'lucide-react';
import { Route as signIn } from '../auth/sign-in';
import { Route as sessions } from './sessions/index';
import { Route as messaging } from './messaging';
import { Route as jobs } from './jobs/index';
import { Route as settings } from './settings';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => {
    if (!context.isAuthenticated) {
      throw redirect({
        to: signIn.to,
        search: {
          redirect: location.href,
        },
      });
    }
  },
  component: RouteComponent,
  context(ctx) {
    return {
      ...ctx,
      getTitle: () => 'App',
    };
  },
});

function RouteComponent() {
  const user = Route.useRouteContext({
    select: (ctx) => ctx.auth?.user,
  });

  const matches = useRouterState({ select: (s) => s.matches });

  const breadcrumbs = matches
    .filter((match) => match.context.getTitle)
    .filter((match) => match.context.getTitle())
    .filter(
      (value, index, array) => array.findIndex((v) => v.pathname === value.pathname) === index,
    )
    .map(({ pathname, context }) => {
      return {
        title: context.getTitle!!(),
        path: pathname,
      };
    });

  const navItems = [
    {
      title: 'Dashboard',
      url: Route.to,
      icon: LayoutDashboard,
    },
    {
      title: 'Sessions',
      url: sessions.to,
      icon: Smartphone,
    },
    {
      title: 'Messaging',
      url: messaging.to,
      icon: Send,
    },
    {
      title: 'Jobs',
      url: jobs.to,
      icon: Clock,
    },
    {
      title: 'Settings',
      url: settings.to,
      icon: SettingsIcon,
    },
  ];

  return (
    <SidebarProvider>
      <AppSidebar homeLink={Route.to} user={user} navItems={navItems} />
      <SidebarInset>
        <SiteHeader breadcrumbs={breadcrumbs} />
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
