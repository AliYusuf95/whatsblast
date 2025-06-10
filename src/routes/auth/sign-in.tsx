import { createFileRoute } from '@tanstack/react-router';
import { MyAuthCard } from './-MyAuthCard';
import { z } from 'zod/v4';
import { zodValidator } from '@tanstack/zod-adapter';

const authSearchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute('/auth/sign-in')({
  component: Component,
  validateSearch: zodValidator(authSearchSchema),
});

function Component() {
  const { redirect } = Route.useSearch();
  return <MyAuthCard view="signIn" redirectTo={redirect} />;
}
