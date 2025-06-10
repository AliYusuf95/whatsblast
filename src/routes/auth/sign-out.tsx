import { createFileRoute } from '@tanstack/react-router';
import { MyAuthCard } from './-MyAuthCard';

export const Route = createFileRoute('/auth/sign-out')({
  component: Component,
});

function Component() {
  return <MyAuthCard view="signOut" />;
}
