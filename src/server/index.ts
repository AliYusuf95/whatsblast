import { createBunHttpHandler } from 'trpc-bun-adapter';
import { createContext, publicProcedure, router } from './trpc';
import { authRouter } from './auth/routes';
import { sessionRouter } from './api/session-routes';
import { bulkRouter } from './api/bulk-routes';

const appRouter = router({
  // Authentication routes
  auth: authRouter,

  // Session management routes
  sessions: sessionRouter,

  // Bulk messaging routes
  bulk: bulkRouter,
});

export const trpcHandler = createBunHttpHandler({
  router: appRouter,
  endpoint: '/trpc',
  onError: console.error,
  createContext,
  responseMeta(opts) {
    return {
      status: 202,
      headers: {},
    };
  },
  batching: {
    enabled: true,
  },
  emitWsUpgrades: false,
});

// Export type router type signature,
// NOT the router itself.
export type AppRouter = typeof appRouter;
