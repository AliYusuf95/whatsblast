"use client";

import { SidebarIcon, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Link, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  AlertDialogFooter,
  AlertDialogHeader,
} from "./ui/alert-dialog";
import { ModeToggle } from "./mode-toggle";
import logo from "@/logo.svg";

export function SiteHeader() {
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
    <header className="flex sticky top-0 z-50 w-full h-14 items-center border-b bg-background">
      <div className="flex h-[--header-height] w-full items-center gap-2 px-4">
        <img src={logo} className="h-10" alt="logo" />
        {loggedIn ? (
          <>
            <Link to="/bulk" className="[&.active]:font-bold">
              Send Messages
            </Link>

            <Link to="/bulk-template" className="[&.active]:font-bold">
              Send Template
            </Link>
          </>
        ) : (
          <Link to="/login" className="[&.active]:font-bold">
            Login
          </Link>
        )}
        <Separator orientation="vertical" className="mr-2 h-4" />
        <div className="sm:ml-auto sm:w-auto">
          {loggedIn && (
            <AlertDialog
              open={showLogoutConfirm}
              onOpenChange={setShowLogoutConfirm}
            >
              <AlertDialogTrigger asChild>
                <Button
                  className="[&.active]:font-bold"
                  variant="destructive"
                  onClick={() => setShowLogoutConfirm(true)}
                  disabled={logoutMutation.isPending}
                >
                  <User /> Logout
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to logout?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive"
                    onClick={() => {
                      setShowLogoutConfirm(false);
                      logoutMutation.mutate();
                    }}
                  >
                    Logout
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <ModeToggle />
        </div>
      </div>
    </header>
  );
}
