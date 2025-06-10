import { createAuthClient } from 'better-auth/react';
import { API_URL } from './utils';
import { genericOAuthClient, usernameClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
  baseURL: API_URL, // The base URL of your auth server
  plugins: [usernameClient(), genericOAuthClient()],
});
