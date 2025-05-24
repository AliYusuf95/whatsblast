import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { queryClient, trpc } from "@/lib/trpc";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/login")({
  loader: () => queryClient.ensureQueryData(trpc.checkLogin.queryOptions()),
  component: Login,
});

function Login() {
  const navigate = useNavigate();

  const { data: loggedIn } = useQuery(
    trpc.checkLogin.queryOptions(undefined, {
      refetchInterval: 2000,
    })
  );

  const { data: qr, refetch } = useQuery(
    trpc.getQrCode.queryOptions(undefined, {
      enabled: !loggedIn,
      refetchInterval: (query) => {
        // If QR is not available, decrease interval to 2 seconds
        if (!query.state.data) return 1000;
        // Otherwise use normal 10 second interval
        return 10000;
      },
    })
  );

  useEffect(() => {
    if (loggedIn) {
      navigate({ to: "/bulk" });
    }
  }, [loggedIn, navigate]);

  return (
    <div className="flex justify-center items-center min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 pt-6">
          <h2 className="text-2xl font-bold mb-2">Login to WhatsApp</h2>
          {qr ? (
            <img src={qr} alt="WhatsApp QR Code" className="w-64 h-64" />
          ) : (
            <div className="w-64 h-64 flex items-center justify-center bg-muted rounded">
              <Spinner />
            </div>
          )}
          <Button onClick={() => refetch()}>Refresh QR</Button>
        </CardContent>
      </Card>
    </div>
  );
}
