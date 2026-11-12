import { useEffect, useMemo, useRef, useState } from 'react';
import { useUpdateUser, type AdminUser } from '@/api/admin';
import { ApiError } from '@/lib/http';
import {
  ConfirmDialog,
  DataTable,
  Flag,
  SearchField,
  Tag,
  Text,
  UserName,
  useToast,
  type Column,
} from '@/ui';
import styles from './users.module.css';

export interface UsersTableProps {
  users: AdminUser[];
  meId: string;
  onEdit: (user: AdminUser) => void;
  /** Row to flash after create (`existing` case). */
  highlightId?: string | null;
}

const UNDO_MS = 10_000;

/** Users table: role tag, status badge, Edit + Disable (confirm, Undo toast) / Enable (no confirm). */
export function UsersTable({ users, meId, onEdit, highlightId }: UsersTableProps) {
  const update = useUpdateUser();
  const toast = useToast();
  const [disabling, setDisabling] = useState<AdminUser | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const highlightRef = useRef<string | null>(null);
  useEffect(() => {
    highlightRef.current = highlightId ?? null;
    if (!highlightId) return;
    const row = document.querySelector<HTMLElement>(`[data-user-row="${highlightId}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [highlightId]);

  const label = (u: AdminUser) => u.display_name || u.email;
  const errText = (e: unknown) =>
    e instanceof ApiError ? e.detail || `HTTP ${e.status}` : e instanceof Error ? e.message : String(e);

  async function setActive(user: AdminUser, active: boolean, { silent = false } = {}) {
    setPendingId(user.id);
    try {
      await update.mutateAsync({ id: user.id, body: { is_active: active } });
      if (active) {
        toast.show(
          silent ? `Enabled ${label(user)} again. They need to sign in again.` : `Enabled ${label(user)}`,
          { tone: 'success' },
        );
      } else {
        toast.show(`Disabled ${label(user)}`, {
          tone: 'info',
          timeout: UNDO_MS,
          action: { label: 'Undo', onClick: () => void setActive(user, true, { silent: true }) },
        });
      }
    } catch (e) {
      toast.show(`${active ? 'Enable' : 'Disable'} failed: ${errText(e)}`, { tone: 'error' });
    } finally {
      setPendingId(null);
    }
  }

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      users.filter(
        (u) => !q || u.email.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q),
      ),
    [users, q],
  );
  const columns = useMemo<Column<AdminUser>[]>(
    () => [
      {
        id: 'user',
        header: 'User',
        flex: true,
        minWidth: 180,
        pin: 'start',
        hideable: false,
        priority: 1,
        sort: { key: 'user', compare: (a, b) => label(a).localeCompare(label(b)) },
        cell: (u) => (
          <span
            className={styles.userCell}
            data-user-row={u.id}
            data-highlight={highlightId === u.id || undefined}
          >
            <UserName id={u.id} name={u.display_name} email={u.email} />
            {u.id === meId ? (
              <Tag kind="data" className={styles.youTag}>
                you
              </Tag>
            ) : null}
            {/* on/off state: only the exception shows, after the name (no Status column) */}
            {u.is_active ? null : (
              <Flag icon="ban" data-status="disabled" className={styles.offMark}>
                Disabled
              </Flag>
            )}
          </span>
        ),
      },
      {
        id: 'email',
        header: 'Email',
        type: 'id',
        width: 240,
        priority: 2,
        sort: { key: 'email', compare: (a, b) => a.email.localeCompare(b.email) },
        cell: (u) => u.email,
      },
      {
        id: 'role',
        header: 'Role',
        width: 110,
        priority: 2,
        cell: (u) => <Tag kind="role">{u.role === 'ADMIN' ? 'admin' : 'member'}</Tag>,
      },
    ],
    [meId, highlightId],
  );

  return (
    <>
      <DataTable<AdminUser>
        aria-label="Users"
        columns={columns}
        rows={shown}
        rowKey={(u) => u.id}
        storageKey="admin-users"
        density="comfortable"
        densityLocked
        empty="No users yet"
        isFiltered={q !== ''}
        filteredEmpty={<Text variant="sm">No users match “{query.trim()}”.</Text>}
        rowActions={(u) => {
          const self = u.id === meId;
          const busy = pendingId === u.id;
          return [
            { id: 'edit', label: `Edit ${label(u)}`, icon: 'edit', primary: true, onPress: onEdit },
            self
              ? {
                  id: 'disable',
                  label: 'You cannot disable your own account',
                  hint: 'You cannot disable your own account',
                  icon: 'ban',
                  primary: true,
                  danger: true,
                  disabled: true,
                  onPress: () => undefined,
                }
              : u.is_active
                ? {
                    id: 'disable',
                    label: `Disable ${label(u)}`,
                    icon: 'ban',
                    primary: true,
                    danger: true,
                    disabled: busy,
                    onPress: setDisabling,
                  }
                : {
                    id: 'enable',
                    label: `Enable ${label(u)}`,
                    icon: 'play',
                    primary: true,
                    disabled: busy,
                    onPress: (user: AdminUser) => void setActive(user, true),
                  },
          ];
        }}
      >
        <DataTable.Toolbar
          columnsMenu={false}
          search={
            <SearchField
              label="Search users"
              placeholder="Search users"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery('')}
              width="var(--search-width)"
              shortcut="/"
            />
          }
        />
        <DataTable.Footer
          filterNote={q ? `Filtered from ${users.length} users` : undefined}
          pagination={{
            total: shown.length,
            page: 1,
            pageSize: Math.max(1, shown.length),
            noun: 'users',
            onPageChange: () => {},
          }}
        />
      </DataTable>
      <ConfirmDialog
        open={disabling !== null}
        onOpenChange={(o) => !o && setDisabling(null)}
        title={`Disable ${disabling?.email ?? 'this user'}?`}
        tone="danger"
        description={[
          'They are signed out everywhere at once and cannot sign in until an admin enables them again.',
          'Their API keys stop working while they are disabled.',
        ]}
        confirmLabel="Disable user"
        onConfirm={async () => {
          const user = disabling;
          if (!user) return;
          await setActive(user, false);
        }}
      />
    </>
  );
}
