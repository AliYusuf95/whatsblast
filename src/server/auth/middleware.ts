// tRPC Authentication Middleware
// Integrates Better-Auth with tRPC context and procedures

import { TRPCError } from '@trpc/server';
import { auth } from './config';
import type { User, Session } from './config';
import type { CreateBunContextOptions } from 'trpc-bun-adapter';

// Type for authenticated context
interface AuthContext {
  session: Session | null;
  user: User | null;
}

// Create authentication context for tRPC
export async function createAuthContext(opts: CreateBunContextOptions): Promise<AuthContext> {
  try {
    const sessionData = await auth.api.getSession({
      headers: opts.req.headers,
    });

    return {
      session: sessionData?.session || null,
      user: sessionData?.user || null,
    };
  } catch (error) {
    console.log('Failed to get session:', error);
    return {
      session: null,
      user: null,
    };
  }
}

// Helper to require authentication
export const requireAuth = (context: AuthContext) => {
  if (!context.user || !context.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return {
    user: context.user,
    session: context.session,
  };
};

// Helper to get user ID from context
export const getUserId = (context: AuthContext): string => {
  const auth = requireAuth(context);
  return auth.user.id;
};

// Auth routes that can be used in API handlers
export const authAPI = { ...auth.api };
