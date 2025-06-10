import { createFileRoute } from '@tanstack/react-router';
import { MyAuthCard } from './-MyAuthCard';

export const Route = createFileRoute('/auth/reset-password')({
  component: Component,
});

function Component() {
  return <MyAuthCard view="resetPassword" />;
}
