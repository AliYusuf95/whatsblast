import {
  createRootRoute,
  Link,
  Outlet,
  useRouter,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { trpc } from "@/lib/trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { SiteHeader } from "@/components/SiteHeader";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const router = useRouter();
  const { data: loggedIn, refetch } = useQuery(
    trpc.checkLogin.queryOptions(undefined, { refetchInterval: 10000 })
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const logoutMutation = useMutation(
    trpc.logout.mutationOptions({
      onSuccess: () => {
        refetch();
        router.navigate({ to: "/login" });
      },
    })
  );

  return (
    <>
      <SiteHeader />
      <Outlet />
      {/* <TanStackRouterDevtools /> */}
    </>
  );
}
