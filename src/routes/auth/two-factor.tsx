import { createFileRoute } from '@tanstack/react-router';
import { MyAuthCard } from './-MyAuthCard';

export const Route = createFileRoute('/auth/two-factor')({
  component: Component,
});

function Component() {
  return <MyAuthCard view="twoFactor" />;
}
