import { Outlet } from 'react-router-dom';
import { useAuth } from '@/features/shell/AuthContext';
import { constrained } from '@/features/shell/layout';
import { EmptyState, Icon, LinkButton } from '@/ui';

/** Admin routes: non-admins get a forbidden panel (the server also 403s every call). */
export function AdminGuard() {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <div className={constrained} data-admin-forbidden>
        <EmptyState
          icon={<Icon name="shield" />}
          title="Admin access required"
          body="Only platform administrators can open this page."
          action={
            <LinkButton to="/" variant="neutral" icon={<Icon name="prev" size={12} />}>
              Back to projects
            </LinkButton>
          }
        />
      </div>
    );
  }
  return <Outlet />;
}
