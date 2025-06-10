import { AuthCard, type AuthView } from '@daveyplate/better-auth-ui';
import { useLocation } from '@tanstack/react-router';

interface AuthCardProps extends React.ComponentProps<typeof AuthCard> {
  view: AuthView;
}

export function MyAuthCard({ view, ...props }: AuthCardProps) {
  const location = useLocation();
  if (!location.pathname.startsWith('/auth')) {
    return null;
  }
  return <AuthCard view={view} pathname={location.pathname} {...props} />;
}
