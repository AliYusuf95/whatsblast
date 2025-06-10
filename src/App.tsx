import { Link, RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthQueryProvider } from '@daveyplate/better-auth-tanstack';
import { AuthUIProviderTanstack } from '@daveyplate/better-auth-ui/tanstack';

import { Toaster } from '@/components/ui/sonner';
import { queryClient } from '@/lib/trpc';

import './index.css';
// Import the generated route tree
import { routeTree } from './routeTree.gen';
import { authClient } from './lib/auth-client';
import { ThemeProvider } from 'next-themes';
import { NotFound } from './components/not-found';
import { Spinner } from './components/ui/spinner';
import { useAuth } from './hooks/use-auth';
import { House } from 'lucide-react';
import { getAuthProvider } from './lib/utils';

// Create a new router instance
const router = createRouter({
  routeTree,
  context: {
    // auth will initially be undefined
    // We'll be passing down the auth state from within a React component
    auth: undefined!,
    isAuthenticated: false,
  },
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultNotFoundComponent: NotFound,
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const OAUTH_PROVIDER = getAuthProvider();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthQueryProvider>
        <AuthUIProviderTanstack
          authClient={authClient}
          navigate={(href) => router.navigate({ href })}
          replace={(href) => router.navigate({ href, replace: true })}
          Link={({ href, ...props }) => <Link to={href} {...props} />}
          avatar
          otherProviders={[
            ...(OAUTH_PROVIDER
              ? [
                  {
                    provider: OAUTH_PROVIDER.id || '',
                    name: OAUTH_PROVIDER.name || '',
                    icon: ({ className }: { className?: string }) => (
                      <House className={className} />
                    ),
                  },
                ]
              : []),
          ]}
          viewPaths={{
            settings: 'settings',
            signIn: 'sign-in',
            signUp: 'sign-up',
            forgotPassword: 'forgot-password',
            resetPassword: 'reset-password',
            callback: 'callback',
            emailOTP: 'email-otp',
            magicLink: 'magic-link',
            recoverAccount: 'recover-account',
            signOut: 'sign-out',
            twoFactor: 'two-factor',
          }}
        >
          <ThemeProvider storageKey="ui-theme" attribute={'class'}>
            <AppRouter />
            <Toaster richColors />
          </ThemeProvider>
        </AuthUIProviderTanstack>
      </AuthQueryProvider>
    </QueryClientProvider>
  );
}

function AppRouter() {
  const { auth, isAuthenticated, isPending } = useAuth();
  if (isPending) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <Spinner />
      </div>
    );
  }
  return <RouterProvider router={router} context={{ auth, isAuthenticated }} />;
}

export default App;
