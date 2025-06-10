import { initTRPC } from '@trpc/server';
import { createAuthContext, requireAuth } from './auth/middleware';
import type { CreateBunContextOptions } from 'trpc-bun-adapter';
import { db } from './db';
import { whatsappConnectionManager, whatsappSessionService, whatsappBulkService } from './services';

export async function createContext(opts: CreateBunContextOptions) {
  const contextAuth = await createAuthContext(opts);
  return {
    ...contextAuth,
    db: db,
    services: {
      whatsappSessionService,
      whatsappBulkService,
      whatsappConnectionManager,
    },
    req: opts.req,
  };
}

export type TrpcContext = Awaited<ReturnType<typeof createContext>>;

// Create tRPC instance with auth context
const t = initTRPC.context<TrpcContext>().create();

// Export router and procedures
export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

// Protected procedure that requires authentication
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const authData = requireAuth(ctx);
  return next({
    ctx: {
      ...ctx,
      user: authData.user,
      session: authData.session,
    },
  });
});
