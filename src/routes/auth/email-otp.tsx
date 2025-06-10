import { createFileRoute } from '@tanstack/react-router';
import { AuthCard } from '@daveyplate/better-auth-ui';
import { MyAuthCard } from './-MyAuthCard';

export const Route = createFileRoute('/auth/email-otp')({
  component: Component,
});

function Component() {
  return <MyAuthCard view="emailOTP" />;
}
