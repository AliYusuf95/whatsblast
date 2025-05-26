import { createRootRoute, Outlet, useRouter } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const router = useRouter();
  router.navigate({ to: "/login" });

  return (
    <>
      <SiteHeader />
      <Outlet />
      {/* <TanStackRouterDevtools /> */}
    </>
  );
}
