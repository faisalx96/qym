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
import { ApiError, actionErrorMessage } from '@/lib/http';
import { useDelayedPending, useSubmitLock } from '@/lib/pending';
import {
  Button,
  Icon,
  ConfirmDialog,
  DataTable,
  ErrorState,
  SearchField,
  Select,
  Skeleton,
  Stack,
  Tag,
  Text,
  useToast,
  RelativeTime,
  UserName,
  type Column,
  type RowAction,
} from '@/ui';
import { useAuth } from '../AuthContext';
import { useProjectContext } from '../ProjectContext';
import { plural } from '../plural';
import styles from './settings.module.css';
import { transferCandidates } from './transferCandidates';
import { SettingsCard } from './SettingsCard';

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
  const [inlineRole, setInlineRole] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ member: Member; preview: RemovalPreview | null } | null>(null);
  const [transferTo, setTransferTo] = useState<string | null>(null);

  const columns: Column<Member>[] = [
    {
      id: 'name',
      header: 'Member',
      flex: true,
      minWidth: 160,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (m) => <UserName id={m.user_id} name={m.display_name} email={m.email} />,
    },
    { id: 'email', header: 'Email', type: 'id', width: 220, priority: 2, cell: (m) => m.email },
    {
      id: 'added',
      header: 'Added',
      type: 'date',
      width: 130,
      priority: 3,
      cell: (m) => <RelativeTime iso={m.created_at} />,
    },
    {
      id: 'role',
      header: 'Role',
      width: 110,
      priority: 1,
      // the role is a tag, as in admin users; the pencil turns it into a Select that saves on pick and
      // Escape cancels (C186: no one-field modal per person)
      cell: (m) =>
        inlineRole === m.user_id ? (
          <Select
            label={`Role of ${m.display_name || m.email}`}
            hideLabel
            items={ROLE_ITEMS}
            value={m.role}
            defaultOpen
            autoFocus
            width={110}
            onOpenChange={(open) => {
              if (!open) setInlineRole(null);
            }}
            onChange={(k) => {
              setInlineRole(null);
              const role = k as Role;
              if (!role || role === m.role) return;
              updateRole
                .mutateAsync({ userId: m.user_id, role })
                .then(() => toast.show('Role saved', { tone: 'success' }))
                .catch((e: unknown) =>
                  toast.show(
                    e instanceof ApiError ? e.detail || 'Couldn’t save the role' : 'Couldn’t save the role',
                    { tone: 'error' },
                  ),
                );
            }}
          />
        ) : (
          <Tag kind="role">{m.role.toLowerCase()}</Tag>
        ),
    },
  ];

  const rowActions = (m: Member): RowAction<Member>[] => [
    ...(canManage && !readOnly
      ? [
          {
            id: 'edit',
            label: `Change the role of ${m.display_name || m.email}`,
            icon: 'edit',
            primary: true,
            onPress: () => setInlineRole(m.user_id),
          },
        ]
      : []),
    ...(canManage && m.user_id !== me.id
      ? [
          {
            id: 'remove',
            label: `Remove ${m.display_name || m.email}`,
            icon: 'trash',
            primary: true,
            danger: true,
            onPress: async () => {
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
            },
          },
        ]
      : []),
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
    <SettingsCard
      title="Members"
      description={
        canManage
          ? 'People who can open this project. Managers add and remove members and change their roles.'
          : 'People who can open this project. Only project managers can change members.'
      }
      data-members
    >
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
        <DataTable<Member>
          density="regular"
          rowActions={rowActions}
          aria-label="Members"
          columns={columns}
          rows={members.data}
          rowKey={(m) => m.user_id}
          storageKey="settings-members"
          empty="No members yet."
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
              throw new Error(actionErrorMessage('remove the member', e));
            }
          }}
        />
      ) : null}
    </SettingsCard>
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
  const lock = useSubmitLock();
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
      onSubmit={(e) => {
        e.preventDefault();
        if (!picked) return;
        void lock(async () => {
          try {
            await add.mutateAsync({ user_id: picked.id, role });
            toast.show(`${picked.display_name || picked.email} added`, { tone: 'success' });
            setPicked(null);
            setQuery('');
          } catch (err) {
            toast.show(actionErrorMessage('add the member', err), { tone: 'error' });
          }
        });
      }}
    >
      <div className={styles.combo}>
        {/* the same search field as every other user search (round 11), carrying the combobox semantics */}
        <SearchField
          ref={inputRef}
          label="Add member"
          hideLabel={false}
          placeholder="Search by name or email"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPicked(null);
            setActive(0);
            setOpen(true);
          }}
          onClear={() => setPicked(null)}
          inputProps={{
            role: 'combobox',
            'aria-expanded': open && options.length > 0,
            'aria-controls': listId,
            'aria-autocomplete': 'list',
            'aria-activedescendant': open && options[active] ? `${listId}-${options[active].id}` : undefined,
            autoComplete: 'off',
            onFocus: () => setOpen(true),
            onBlur: () => setTimeout(() => setOpen(false), 120),
            onKeyDown: (e) => {
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
            },
          }}
        />
        {open && options.length === 0 && !candidates.isFetching ? (
          <div className={styles.comboHint} role="status">
            {candidates.isError
              ? `Couldn’t search people: ${candidates.error instanceof ApiError ? candidates.error.detail || candidates.error.message : 'try again'}`
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
                <UserName id={c.id} name={c.display_name} email={c.email} showEmail />
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
      <Button
        type="submit"
        variant="primary"
        icon={<Icon name="plus" size={12} />}
        isDisabled={!picked}
        disabledReason="Pick a user first"
        loading={add.isPending}
      >
        Add member
      </Button>
    </form>
  );
}
