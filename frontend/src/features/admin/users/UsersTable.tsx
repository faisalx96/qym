import { useEffect, useMemo, useRef, useState } from 'react';
import { Focusable } from 'react-aria-components';
import { useUpdateUser, type AdminUser } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { Badge, Button, ConfirmDialog, DataTable, Tag, Tooltip, useToast, type Column } from '@/ui';
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

  const columns = useMemo<Column<AdminUser>[]>(
    () => [
      {
        id: 'user',
        label: 'User',
        flex: true,
        minWidth: 180,
        cell: (u) => (
          <span data-user-row={u.id} data-highlight={highlightId === u.id || undefined}>
            {label(u)}
            {u.id === meId ? (
              <Tag kind="data" className={styles.youTag}>
                you
              </Tag>
            ) : null}
          </span>
        ),
      },
      { id: 'email', label: 'Email', width: 240, mono: true, cell: (u) => u.email },
      {
        id: 'role',
        label: 'Role',
        width: 110,
        cell: (u) => (
          <Tag kind="role" tone={u.role === 'ADMIN' ? 'success' : undefined}>
            {u.role === 'ADMIN' ? 'admin' : 'member'}
          </Tag>
        ),
      },
      {
        id: 'status',
        label: 'Status',
        width: 110,
        cell: (u) =>
          u.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>,
      },
      {
        id: 'actions',
        label: 'Actions',
        hideLabel: true,
        width: 170,
        resizable: false,
        align: 'end',
        cell: (u) => {
          const self = u.id === meId;
          const busy = pendingId === u.id;
          return (
            <span className={styles.rowActions}>
              <Button
                variant="neutral"
                onPress={() => onEdit(u)}
                aria-label={`Edit ${label(u)}`}
                data-user-edit={u.id}
              >
                Edit
              </Button>
              {self ? (
                <Tooltip content="You cannot disable your own account">
                  {/* A plain focusable stand-in for the disabled button: a disabled button cannot take focus or hover */}
                  <Focusable>
                    <span
                      role="button"
                      aria-disabled="true"
                      aria-label="You cannot disable your own account"
                      className={styles.disabledTrigger}
                      data-user-self-disable
                      data-user-self-disable-wrap
                    >
                      Disable
                    </span>
                  </Focusable>
                </Tooltip>
              ) : u.is_active ? (
                <Button
                  variant="ghost"
                  onPress={() => setDisabling(u)}
                  isDisabled={busy}
                  loading={busy}
                  aria-label={`Disable ${label(u)}`}
                  data-user-disable={u.id}
                >
                  Disable
                </Button>
              ) : (
                <Button
                  variant="neutral"
                  onPress={() => void setActive(u, true)}
                  isDisabled={busy}
                  loading={busy}
                  aria-label={`Enable ${label(u)}`}
                  data-user-enable={u.id}
                >
                  Enable
                </Button>
              )}
            </span>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [meId, onEdit, pendingId, highlightId],
  );

  return (
    <>
      <DataTable
        aria-label="Users"
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        storageKey="admin-users"
        emptyState="No users yet."
      />
      <ConfirmDialog
        open={disabling !== null}
        onOpenChange={(o) => !o && setDisabling(null)}
        title="Disable user"
        tone="danger"
        description={[
          `Disable ${disabling?.email ?? 'this user'}? They are signed out everywhere at once and cannot sign in until an admin enables them again.`,
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
