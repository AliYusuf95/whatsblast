// Better-Auth tRPC Routes
// Handles authentication endpoints using tRPC procedures

import { z } from 'zod/v4';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { authAPI } from './middleware';

// Input validation schemas
const signInSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
});

const signUpSchema = z.object({
  email: z.email(),
  password: z.string().min(6),
  name: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.email(),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  newPassword: z.string().min(6),
});

// Auth router with Better-Auth integration
export const authRouter = router({
  // Sign in with email and password
  signIn: publicProcedure.input(signInSchema).mutation(async ({ input, ctx }) => {
    try {
      const result = await authAPI.signInEmail({
        body: input,
        headers: ctx.req.headers,
      });
      ctx.req.redirect;
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Sign in failed');
    }
  }),

  // Sign up with email and password
  signUp: publicProcedure.input(signUpSchema).mutation(async ({ input, ctx }) => {
    try {
      const result = await authAPI.signUpEmail({
        body: input,
        headers: ctx.req.headers,
      });
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Sign up failed');
    }
  }),

  // Sign out
  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const result = await authAPI.signOut({
        headers: ctx.req.headers,
      });
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Sign out failed');
    }
  }),

  // Get current session
  getSession: publicProcedure.query(async ({ ctx }) => {
    try {
      const result = await authAPI.getSession({
        headers: ctx.req.headers,
      });
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        data: null,
      };
    }
  }),

  // Get current user
  getUser: protectedProcedure.query(async ({ ctx }) => {
    return {
      success: true,
      data: ctx.user,
    };
  }),

  // Forgot password
  forgotPassword: publicProcedure.input(forgotPasswordSchema).mutation(async ({ input, ctx }) => {
    try {
      const result = await authAPI.forgetPassword({
        body: input,
        headers: ctx.req.headers,
      });
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Forgot password failed');
    }
  }),

  // Reset password
  resetPassword: publicProcedure.input(resetPasswordSchema).mutation(async ({ input, ctx }) => {
    try {
      const result = await authAPI.resetPassword({
        body: input,
        headers: ctx.req.headers,
      });
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Reset password failed');
    }
  }),
});
