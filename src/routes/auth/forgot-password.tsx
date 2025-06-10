import { createFileRoute } from '@tanstack/react-router';
import { MyAuthCard } from './-MyAuthCard';

export const Route = createFileRoute('/auth/forgot-password')({
  component: Component,
});

function Component() {
  return <MyAuthCard view="forgotPassword" />;
}
