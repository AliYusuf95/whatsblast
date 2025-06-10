import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/sessions')({
  component: RouteComponent,
  context(ctx) {
    return {
      ...ctx,
      getTitle: () => 'WhatsApp Sessions',
    };
  },
});

function RouteComponent() {
  return <Outlet />;
}
