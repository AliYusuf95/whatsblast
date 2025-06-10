import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import type { authClient } from '@/lib/auth-client';

interface AuthContext {
  auth: ReturnType<typeof authClient.useSession>['data'] | undefined;
  isAuthenticated: boolean;
  getTitle?: () => string;
}

export const Route = createRootRouteWithContext<AuthContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      {/* <TanStackRouterDevtools /> */}
    </>
  );
}
