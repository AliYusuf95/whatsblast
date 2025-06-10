// Better-Auth Configuration
// Integrates with Drizzle ORM for user authentication

import { betterAuth, type AuthContext, type BetterAuthOptions } from 'better-auth';
import { type Router } from 'better-call';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { oidcProvider } from 'better-auth/plugins/oidc-provider';
import { db, schema } from '../db/config';
import { createId } from '@paralleldrive/cuid2';
import { Route as signIn } from '../../routes/auth/sign-in';
import { sso } from 'better-auth/plugins/sso';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { username } from 'better-auth/plugins/username';

// Environment variables for auth configuration
const AUTH_SECRET = process.env.AUTH_SECRET || 'change-it';
const AUTH_TRUST_HOST = process.env.AUTH_TRUST_HOST === 'true';
const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

export const auth = betterAuth({
  appName: 'WhatsBlast',
  basePath: '/api/auth',
  // Database adapter configuration
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  plugins: [
    username(),
    genericOAuth({
      config: [
        {
          providerId: process.env.BUN_PUBLIC_OAUTH_PROVIDER_ID || '',
          clientId: process.env.OAUTH_CLIENT_ID || '',
          clientSecret: process.env.OAUTH_CLIENT_SECRET || '',
          discoveryUrl: process.env.OAUTH_DISCOVERY_URL || '',
          scopes: ['openid', 'email', 'groups'],
          mapProfileToUser(profile) {
            if (
              !profile.groups?.includes('administrators') &&
              !profile.groups?.includes('whatsblast')
            ) {
              console.error(
                'User must be part of "administrators" or "whatsblast" groups',
                profile.groups,
              );
              return {};
            }
            return {
              name: profile.name || profile.username,
              email: profile.email || profile.username,
              image: profile.image,
              username: profile.username,
            };
          },
        },
      ],
    }),
  ],

  emailVerification: {
    autoSignInAfterVerification: true,
    expiresIn: 3600, // 1 hour
    sendVerificationEmail: async ({ user, token, url }, request) => {
      console.log(`Sending verification email to ${user.email} with token ${token} and URL ${url}`);
    },
  },

  // Authentication providers and methods
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
    sendResetPassword: async ({ user, url, token }, request) => {
      console.log(
        `Sending password reset email to ${user.email} with token ${token} and URL ${url}`,
      );
    },
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  // Security settings
  secret: AUTH_SECRET,
  baseURL: BASE_URL,
  trustedOrigins: AUTH_TRUST_HOST ? undefined : [BASE_URL],

  // Advanced settings
  advanced: {
    crossSubDomainCookies: {
      enabled: false,
    },
    database: {
      generateId: createId,
    },
  },

  // Callbacks and hooks
  callbacks: {
    signIn: {
      before: async (context) => {
        // Add any pre-signin logic here
        console.log(`User attempting to sign in: ${context.user?.email}`);
        return context;
      },
      after: async (context) => {
        // Add any post-signin logic here
        console.log(`User signed in: ${context.user?.email}`);
        return context;
      },
    },
    signUp: {
      before: async (context) => {
        // Add any pre-signup logic here
        console.log(`New user attempting to sign up: ${context.user?.email}`);
        return context;
      },
      after: async (context) => {
        // Add any post-signup logic here
        console.log(`New user signed up: ${context.user?.email}`);
        return context;
      },
    },
  },
} as BetterAuthOptions);

export type Session = typeof auth.$Infer.Session.session;
export type User = typeof auth.$Infer.Session.user;

export function toBunHandler(handler: Router['handler']) {
  return async (req: Request) => {
    return await handler(req);
  };
}

export const bunHandler = auth.handler;
