import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { zodValidator } from '@tanstack/zod-adapter';

import { Route as dashboard } from '../_app/index';
import { Route as callback } from './callback';
import { Route as emailOTP } from './email-otp';
import { Route as recoverAccount } from './recover-account';
import { Route as signIn } from './sign-in';
import { Route as signUp } from './sign-up';
import { Route as forgotPassword } from './forgot-password';
import { Route as magicLink } from './magic-link';
import { Route as resetPassword } from './reset-password';
import { Route as signOut } from './sign-out';
import { Route as twoFactor } from './two-factor';
import { z } from 'zod/v4';

const authSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute('/auth')({
  validateSearch: zodValidator(authSearchSchema),
  beforeLoad: async ({ context, location, search }) => {
    const withAuthFallback = dashboard.to;
    const nonAuthFallback = signIn.to;

    const noAuthPaths: string[] = [
      callback.to,
      emailOTP.to,
      recoverAccount.to,
      signIn.to,
      signUp.to,
      forgotPassword.to,
      resetPassword.to,
      magicLink.to,
      twoFactor.to,
    ];
    const requireAuthPaths: string[] = [signOut.to];

    const searchRedirect = search?.redirect;
    const authRedirect = searchRedirect || withAuthFallback;

    if (!context.isAuthenticated && !noAuthPaths.includes(location.pathname)) {
      throw redirect({
        to: nonAuthFallback,
      });
    } else if (context.isAuthenticated && !requireAuthPaths.includes(location.pathname)) {
      throw redirect({
        to: authRedirect,
      });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="flex justify-center items-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3 w-full max-w-11/12">
        <Outlet />
      </div>
    </div>
  );
}
