import { useCallback, useState } from 'react';
import { useAdminUsers, type AdminUser } from '@/api/admin';
import { useAuthProviders } from '@/api/me';
import { useAuth } from '@/features/shell/AuthContext';
import { useDelayedPending } from '@/lib/pending';
import { ErrorState, SearchField, SectionHeader, Skeleton, Stack, Text } from '@/ui';
import { CreateUserForm } from './CreateUserForm';
import { EditUserDialog } from './EditUserDialog';
import { UsersTable } from './UsersTable';

export function UsersTab() {
  const { me } = useAuth();
  const users = useAdminUsers();
  const providers = useAuthProviders();
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const skeleton = useDelayedPending(users.isPending);
  const onEdit = useCallback((u: AdminUser) => setEditing(u), []);
  // Keep the dialog on the live row (role/active changes arrive via the query cache).
  const current = editing ? (users.data?.find((u) => u.id === editing.id) ?? editing) : null;
  const q = query.trim().toLowerCase();
  const shown = users.data?.filter(
    (u) => !q || u.email.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q),
  );
  return (
    <Stack gap="md">
      <SectionHeader title="Users" description={users.data ? `${users.data.length} users` : undefined} />
      <CreateUserForm onCreated={(id, existing) => setHighlight(existing ? id : null)} />
      {users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} compact />
      ) : users.isPending ? (
        skeleton ? (
          <Skeleton kind="table" rows={4} label="Loading users" />
        ) : null
      ) : (
        <>
          {users.data.length > 8 ? (
            <SearchField
              label="Filter users"
              placeholder="Filter by name or email"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
              width={320}
            />
          ) : null}
          {shown && shown.length === 0 ? (
            <Text variant="sm" role="status">
              No users match “{query.trim()}”.
            </Text>
          ) : (
            <UsersTable users={shown ?? users.data} meId={me.id} onEdit={onEdit} highlightId={highlight} />
          )}
        </>
      )}
      <EditUserDialog
        user={current}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        meId={me.id}
        localAuth={Boolean(providers.data?.local_auth.enabled)}
      />
    </Stack>
  );
}
