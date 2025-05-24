import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import type { AppRouter } from "@/server";

export const queryClient = new QueryClient();

function getApiUrl() {
  if (
    typeof process === "object" &&
    process.env &&
    process.env.BUN_PUBLIC_API_URL
  ) {
    return process.env.BUN_PUBLIC_API_URL;
  }
  return window.location.origin;
}

const API_URL = getApiUrl();

const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc` })],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
