import { createFileRoute } from '@tanstack/react-router';
import { MyAuthCard } from './-MyAuthCard';

export const Route = createFileRoute('/auth/callback')({
  component: Component,
});

function Component() {
  return <MyAuthCard view="callback" />;
}
