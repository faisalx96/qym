import { useEffect, useId, useRef, useState } from 'react';
import {
  fetchRemovalPreview,
  useApiKeys,
  useAddMember,
  useMemberCandidates,
  useMembers,
  useRemoveMember,
  useUpdateMemberRole,
} from '@/api/projectSettings';
import type { Member, MemberCandidate, RemovalPreview } from '@/api/types';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import {
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Select,
  Skeleton,
  Stack,
  Tag,
  Text,
  useToast,
  type Column,
} from '@/ui';
import { useAuth } from '../AuthContext';
import { useProjectContext } from '../ProjectContext';
import { plural } from '../plural';
import styles from './settings.module.css';
import { transferCandidates } from './transferCandidates';

type Role = 'MEMBER' | 'MANAGER';
const ROLE_ITEMS = [
  { key: 'MEMBER', label: 'Member' },
  { key: 'MANAGER', label: 'Manager' },
];

export function MembersTab() {
  const { project, readOnly, canManage } = useProjectContext();
  const { me } = useAuth();
  const members = useMembers(project.id);
  const showSkeleton = useDelayedPending(members.isPending);
  const toast = useToast();
  const updateRole = useUpdateMemberRole(project.id);
  const removeMember = useRemoveMember(project.id);
  const [pendingRoles, setPendingRoles] = useState<Record<string, Role>>({});
  const [removing, setRemoving] = useState<{ member: Member; preview: RemovalPreview | null } | null>(null);
  const [transferTo, setTransferTo] = useState<string | null>(null);

  const columns: Column<Member>[] = [
    { id: 'name', label: 'Member', flex: true, minWidth: 160, cell: (m) => m.display_name || m.email },
    { id: 'email', label: 'Email', width: 220, mono: true, cell: (m) => m.email },
    {
      id: 'added',
      label: 'Added',
      width: 130,
      mono: true,
      cell: (m) => (m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'),
    },
    {
      id: 'role',
      label: 'Role',
      width: 200,
      cell: (m) =>
        canManage && !readOnly ? (
          <span className={styles.inlineActions}>
            <Select
              label={`Role for ${m.email}`}
              hideLabel
              items={ROLE_ITEMS}
              value={pendingRoles[m.user_id] ?? m.role}
              onChange={(k) => setPendingRoles((p) => ({ ...p, [m.user_id]: k as Role }))}
              width={120}
            />
            {pendingRoles[m.user_id] && pendingRoles[m.user_id] !== m.role ? (
              <Button
                variant="accent"
                loading={updateRole.isPending && updateRole.variables?.userId === m.user_id}
                onPress={async () => {
                  try {
                    await updateRole.mutateAsync({ userId: m.user_id, role: pendingRoles[m.user_id]! });
                    setPendingRoles((p) => {
                      const next = { ...p };
                      delete next[m.user_id];
                      return next;
                    });
                    toast.show('Role saved', { tone: 'success' });
                  } catch (e) {
                    toast.show(
                      e instanceof ApiError ? e.detail || 'Could not save role' : 'Could not save role',
                      { tone: 'error' },
                    );
                  }
                }}
              >
                Save
              </Button>
            ) : null}
          </span>
        ) : (
          <Tag kind="role">{m.role}</Tag>
        ),
    },
    {
      id: 'actions',
      label: 'Actions',
      hideLabel: true,
      width: 110,
      resizable: false,
      cell: (m) =>
        canManage && m.user_id !== me.id ? (
          <Button
            variant="danger"
            onPress={async () => {
              setTransferTo(null);
              setRemoving({ member: m, preview: null });
              try {
                setRemoving({ member: m, preview: await fetchRemovalPreview(project.id, m.user_id) });
              } catch {
                setRemoving({
                  member: m,
                  preview: {
                    project_id: project.id,
                    user_id: m.user_id,
                    owned_runs: 0,
                    owned_deleted_runs: 0,
                  },
                });
              }
            }}
          >
            Remove
          </Button>
        ) : null,
    },
  ];

  const others = transferCandidates(members.data ?? [], removing?.member.user_id);
  const keys = useApiKeys(project.id);
  const removingKeys = removing
    ? (keys.data ?? []).filter((k) => !k.revoked_at && k.creator?.id === removing.member.user_id)
    : [];
  const who = removing ? removing.member.display_name || removing.member.email : '';
  const ownedLive = removing?.preview?.owned_runs ?? 0;
  const ownedDeleted = removing?.preview?.owned_deleted_runs ?? 0;
  const ownedTotal = ownedLive + ownedDeleted;
  const target = others.find((m) => m.user_id === transferTo);
  const canTransfer = ownedTotal > 0 && !readOnly && others.length > 0;

  return (
    <Stack gap="lg">
      {canManage && !readOnly ? <AddMemberBar projectId={project.id} existing={members.data ?? []} /> : null}
      {members.isError ? (
        <ErrorState
          error={members.error}
          title="Couldn’t load members"
          onRetry={() => members.refetch()}
          compact
        />
      ) : members.isPending ? (
        showSkeleton ? (
          <Skeleton kind="table" rows={3} />
        ) : null
      ) : (
        <DataTable
          aria-label="Members"
          columns={columns}
          rows={members.data}
          rowKey={(m) => m.user_id}
          storageKey="settings-members"
          emptyState="No members yet."
        />
      )}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={`Remove ${removing.member.display_name || removing.member.email}?`}
          tone="danger"
          description={[
            removingKeys.length
              ? `Revokes ${plural(removingKeys.length, 'API key')} they created here: ${removingKeys
                  .map((k) => k.name || `${k.prefix}…`)
                  .join(', ')}.`
              : 'Any API keys they created for this project are revoked.',
            !removing.preview
              ? 'Checking the runs they own…'
              : ownedTotal
                ? `${who} owns ${plural(ownedTotal, 'run')} in this project${ownedDeleted ? `, ${ownedDeleted} of them in Deleted Runs.` : '.'}`
                : `${who} owns no runs in this project.`,
          ]}
          note={
            removing.preview && ownedTotal ? (
              <Stack gap="sm">
                {canTransfer ? (
                  <Select
                    label="Transfer their runs to"
                    items={[
                      { key: '', label: 'Keep the runs (no transfer)' },
                      ...others.map((m) => ({ key: m.user_id, label: m.display_name || m.email })),
                    ]}
                    value={transferTo ?? ''}
                    onChange={(k) => setTransferTo(k ? String(k) : null)}
                  />
                ) : null}
                <Text variant="sm">
                  {readOnly
                    ? `Runs can be transferred after the project is unarchived; until then they stay owned by ${who}.`
                    : !others.length
                      ? `No other active member can take them, so they stay owned by ${who}.`
                      : target
                        ? `${target.display_name || target.email} becomes their owner and can submit and delete them. Their results and review history stay as they are.`
                        : `They stay in the project, owned by ${who}; a manager can still submit or transfer them later.`}
                </Text>
              </Stack>
            ) : undefined
          }
          confirmLabel={
            target && ownedTotal ? `Transfer ${plural(ownedTotal, 'run')} and remove` : 'Remove member'
          }
          onConfirm={async () => {
            try {
              const res = await removeMember.mutateAsync({
                userId: removing.member.user_id,
                transferTo: canTransfer ? (transferTo ?? undefined) : undefined,
              });
              const moved = Number(res.transferred_runs) || 0;
              toast.show(
                target && moved
                  ? `${who} was removed. ${plural(moved, 'run')} now ${moved === 1 ? 'belongs' : 'belong'} to ${target.display_name || target.email}.`
                  : `${who} was removed.`,
                { tone: 'info' },
              );
            } catch (e) {
              throw new Error(e instanceof ApiError ? e.detail || 'Could not remove' : String(e));
            }
          }}
        />
      ) : null}
    </Stack>
  );
}

/** Combobox: debounced candidate search, ArrowUp/Down, Enter, Escape, aria-activedescendant. */
function AddMemberBar({ projectId, existing }: { projectId: string; existing: Member[] }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<MemberCandidate | null>(null);
  const [role, setRole] = useState<Role>('MEMBER');
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const add = useAddMember(projectId);
  const toast = useToast();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);
  const candidates = useMemberCandidates(projectId, debounced, open && !picked);
  const existingIds = new Set(existing.map((m) => m.user_id));
  const options = (candidates.data?.users ?? []).filter((u) => !existingIds.has(u.id));

  function choose(c: MemberCandidate) {
    setPicked(c);
    setQuery(c.display_name ? `${c.display_name} <${c.email}>` : c.email);
    setOpen(false);
  }

  return (
    <form
      className={styles.addBar}
      data-add-member
      onSubmit={async (e) => {
        e.preventDefault();
        if (!picked) return;
        try {
          await add.mutateAsync({ user_id: picked.id, role });
          toast.show(`${picked.display_name || picked.email} added`, { tone: 'success' });
          setPicked(null);
          setQuery('');
        } catch (err) {
          toast.show(
            err instanceof ApiError ? err.detail || 'Could not add member' : 'Could not add member',
            { tone: 'error' },
          );
        }
      }}
    >
      <div className={styles.combo}>
        <Text variant="sm" as="label" htmlFor={`${listId}-input`}>
          Add member
        </Text>
        <input
          id={`${listId}-input`}
          ref={inputRef}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
          className={styles.comboInput}
          placeholder="Search by name or email"
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(a + 1, Math.max(0, options.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && open && options[active]) {
              e.preventDefault();
              choose(options[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {open && options.length === 0 && !candidates.isFetching ? (
          <div className={styles.comboHint} role="status">
            {candidates.isError
              ? `Could not search people: ${candidates.error instanceof ApiError ? candidates.error.detail || candidates.error.message : 'try again'}`
              : debounced
                ? `No one outside the project matches “${debounced}”.`
                : 'Everyone is already a member.'}
          </div>
        ) : null}
        {open && options.length > 0 ? (
          <ul id={listId} role="listbox" className={styles.comboList} aria-label="Matching users">
            {options.map((c, i) => (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={c.id}
                id={`${listId}-${c.id}`}
                role="option"
                aria-selected={i === active}
                className={styles.comboOption}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c)}
              >
                <span>{c.display_name || c.email}</span>
                <small>{c.email}</small>
              </li>
            ))}
            {candidates.data?.has_more ? (
              <li role="presentation" className={styles.comboHintRow}>
                Keep typing to narrow the list.
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <Select
        label="Role"
        items={ROLE_ITEMS}
        value={role}
        onChange={(k) => setRole((k as Role) ?? 'MEMBER')}
        width={130}
      />
      <Button type="submit" variant="primary" isDisabled={!picked} loading={add.isPending}>
        Add
      </Button>
    </form>
  );
}
