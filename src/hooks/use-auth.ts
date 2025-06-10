import { AuthUIContext } from '@daveyplate/better-auth-ui';
import { useContext, useMemo } from 'react';

export function useAuth() {
  const { hooks } = useContext(AuthUIContext);
  if (!hooks) {
    return {
      auth: undefined,
      isAuthenticated: false,
      isPending: true,
    };
  }
  const { data: auth, isPending } = hooks.useSession();
  return { auth, isAuthenticated: !!auth?.session && !!auth?.user, isPending };
}
