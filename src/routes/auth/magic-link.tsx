import { createFileRoute } from '@tanstack/react-router';
import { AuthCard } from '@daveyplate/better-auth-ui';
import { MyAuthCard } from './-MyAuthCard';

export const Route = createFileRoute('/auth/magic-link')({
  component: Component,
});

function Component() {
  return <MyAuthCard view="magicLink" />;
}
