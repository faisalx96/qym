import { useCallback, useState } from 'react';
import { useAdminUsers, type AdminUser } from '@/api/admin';
import { useAuthProviders } from '@/api/me';
import { useAuth } from '@/features/shell/AuthContext';
import { SecretRevealDialog } from '@/features/shell/dialogs';
import { useDelayedPending } from '@/lib/pending';
import { Button, ErrorState, Icon, Section, Skeleton } from '@/ui';
import { CreateUserDialog } from './CreateUserDialog';
import { EditUserDialog } from './EditUserDialog';
import { UsersTable } from './UsersTable';
import styles from './users.module.css';

export function UsersTab() {
  const { me } = useAuth();
  const users = useAdminUsers();
  const providers = useAuthProviders();
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const skeleton = useDelayedPending(users.isPending);
  const onEdit = useCallback((u: AdminUser) => setEditing(u), []);
  const localAuth = Boolean(providers.data?.local_auth.enabled);
  // Keep the dialog on the live row (role/active changes arrive via the query cache).
  const current = editing ? (users.data?.find((u) => u.id === editing.id) ?? editing) : null;
  return (
    <Section
      title="Users"
      bodyClassName={styles.body}
      actions={
        // The one create action sits at the end of the header, as "New project" on Projects (cv4 A2).
        <Button
          variant="primary"
          icon={<Icon name="plus" size={12} />}
          onPress={() => setCreating(true)}
          data-create-user
        >
          Create user
        </Button>
      }
    >
      {/* The count shows in the tile, the tab badge and the table footer, not here too (C214). A created or existing
          user's row is highlighted and scrolled into view (C227). */}
      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} compact />
      ) : users.isPending ? (
        skeleton ? (
          <Skeleton kind="table" rows={4} label="Loading users" />
        ) : null
      ) : (
        <UsersTable users={users.data} meId={me.id} onEdit={onEdit} highlightId={highlight} />
      )}
      <CreateUserDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => setHighlight(id)}
        onSecret={setSecret}
        localAuth={localAuth}
        providers={(providers.data?.providers ?? [])
          .filter((p) => p.enabled && !p.coming_soon)
          .map((p) => p.label)}
      />
      <SecretRevealDialog
        open={secret !== null}
        onClose={() => setSecret(null)}
        title={secret ? `User ${secret.email} created` : 'User created'}
        noun="One-time password"
        description="Give it to the user. They set a new password at first sign-in. It is not shown again."
        secret={secret?.password ?? null}
      />
      <EditUserDialog
        user={current}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        meId={me.id}
        localAuth={localAuth}
      />
    </Section>
  );
}
