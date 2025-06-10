import { createFileRoute, redirect, useLocation } from '@tanstack/react-router';
import { AuthCard } from '@daveyplate/better-auth-ui';

export const Route = createFileRoute('/_app/settings')({
  component: Component,
  context(ctx) {
    return {
      ...ctx,
      getTitle: () => 'Settings',
    };
  },
});

function Component() {
  return (
    <div className="container mx-auto p-8">
      <AuthCard view={'settings'} pathname={'/auth/settings'} />
    </div>
  );
}
