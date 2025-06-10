import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_app/jobs')({
  component: RouteComponent,
  context(ctx) {
    return {
      ...ctx,
      getTitle: () => 'Messages Jobs',
    };
  },
});

function RouteComponent() {
  return <Outlet />;
}
