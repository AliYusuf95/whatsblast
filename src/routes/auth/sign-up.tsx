import { createFileRoute, useLocation } from '@tanstack/react-router';
import { MyAuthCard } from './-MyAuthCard';

export const Route = createFileRoute('/auth/sign-up')({
  component: Component,
});

function Component() {
  const location = useLocation();
  return <MyAuthCard view="signUp" />;
}
