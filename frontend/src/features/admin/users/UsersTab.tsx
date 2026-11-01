import { useCallback, useState } from 'react';
import { useAdminUsers, type AdminUser } from '@/api/admin';
import { useAuthProviders } from '@/api/me';
import { useAuth } from '@/features/shell/AuthContext';
import { useDelayedPending } from '@/lib/pending';
import { ErrorState, Section, Skeleton } from '@/ui';
import { CreateUserForm } from './CreateUserForm';
import { EditUserDialog } from './EditUserDialog';
import { UsersTable } from './UsersTable';
import styles from './users.module.css';

export function UsersTab() {
  const { me } = useAuth();
  const users = useAdminUsers();
  const providers = useAuthProviders();
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const skeleton = useDelayedPending(users.isPending);
  const onEdit = useCallback((u: AdminUser) => setEditing(u), []);
  // Keep the dialog on the live row (role/active changes arrive via the query cache).
  const current = editing ? (users.data?.find((u) => u.id === editing.id) ?? editing) : null;
  return (
    <Section title="Users" bodyClassName={styles.body}>
      {/* The count shows in the tile, the tab badge and the table footer, not here too (C214). A created or existing
          user's row is highlighted and scrolled into view (C227). */}
      <CreateUserForm
        onCreated={(id) => setHighlight(id)}
        localAuth={Boolean(providers.data?.local_auth.enabled)}
        providers={(providers.data?.providers ?? [])
          .filter((p) => p.enabled && !p.coming_soon)
          .map((p) => p.label)}
      />
      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} compact />
      ) : users.isPending ? (
        skeleton ? (
          <Skeleton kind="table" rows={4} label="Loading users" />
        ) : null
      ) : (
        <>
          <UsersTable users={users.data} meId={me.id} onEdit={onEdit} highlightId={highlight} />
        </>
      )}
      <EditUserDialog
        user={current}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        meId={me.id}
        localAuth={Boolean(providers.data?.local_auth.enabled)}
      />
    </Section>
  );
}
