/**
 * /projects/:slug/bookmarks — the bookmark groups: yours (pinned first, the server orders them, newest pin first)
 * and the groups of other members that hold a public bookmark. One card per group opens its page, where its runs
 * show in the runs table. URL state: ?scope=mine. A card grid page: the primary action and the All | Mine control
 * sit in the PageHeader (DESIGN_LANGUAGE §4).
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  bookmarkKeys,
  updateGroup,
  useBookmarkGroups,
  useCreateGroup,
  useDeleteGroup,
  useUpdateGroup,
  type BookmarkGroup,
  type BookmarkScope,
} from '@/api/bookmarks';
import { formatAgo } from '@/lib/dates';
import { actionErrorMessage } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { constrained } from '@/features/shell/layout';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Flag,
  Icon,
  IconButton,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Tag,
  Text,
  UserName,
  useToast,
} from '@/ui';
import { GroupDialog } from './GroupDialog';
import { bookmarksPath } from './lib/route';
import styles from './BookmarksPage.module.css';

const SCOPES: { value: BookmarkScope; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Your groups and the shared groups of other members' },
  { value: 'mine', label: 'Mine', title: 'Only your groups' },
];

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function GroupCard({
  group,
  slug,
  canEdit,
  busy,
  onTogglePin,
  onEdit,
  onRemove,
}: {
  group: BookmarkGroup;
  slug: string;
  canEdit: boolean;
  busy: boolean;
  onTogglePin: (group: BookmarkGroup) => void;
  onEdit: (group: BookmarkGroup) => void;
  onRemove: (group: BookmarkGroup) => void;
}) {
  return (
    <Card
      as="li"
      to={bookmarksPath(slug, group.id)}
      tone={group.pinned ? 'accent' : undefined}
      rail={group.pinned ? 'left' : 'none'}
      className={styles.group}
      data-testid="group-card"
      data-pinned={group.pinned ? '' : undefined}
      data-mine={group.is_mine ? '' : undefined}
    >
      <div className={styles.head}>
        <Text variant="md" weight={600} as="h2" className={styles.groupName}>
          <span dir="auto">{group.name}</span>
        </Text>
        <div className={styles.flags}>
          {group.pinned ? (
            <Flag tone="info" icon="pin">
              Pinned
            </Flag>
          ) : null}
          {!group.is_mine ? <Flag icon="eye">Shared</Flag> : null}
        </div>
      </div>
      {group.description ? (
        <p className={styles.description} dir="auto">
          {group.description}
        </p>
      ) : null}
      <div className={styles.tags}>
        <Tag kind="count">{plural(group.bookmark_count, 'bookmark')}</Tag>
      </div>
      <div className={styles.foot}>
        <span className={styles.author}>
          <UserName id={group.owner.id} name={group.owner.display_name} email={group.owner.email} />
          <span className={styles.when} title={group.updated_at ?? undefined}>
            {group.updated_at ? formatAgo(group.updated_at) : ''}
          </span>
        </span>
        {canEdit ? (
          <span className={styles.actions}>
            <IconButton
              label={group.pinned ? 'Unpin' : 'Pin to the top'}
              icon={group.pinned ? 'pin-off' : 'pin'}
              tile
              active={group.pinned}
              isDisabled={busy}
              onPress={() => onTogglePin(group)}
              data-testid="group-pin"
            />
            <IconButton
              label="Edit group"
              icon="edit"
              tile
              isDisabled={busy}
              onPress={() => onEdit(group)}
              data-testid="group-edit"
            />
            <IconButton
              label="Remove group"
              icon="trash"
              tile
              tone="danger"
              isDisabled={busy}
              onPress={() => onRemove(group)}
              data-testid="group-delete"
            />
          </span>
        ) : null}
      </div>
    </Card>
  );
}

/** The mutations of one group: the hooks are keyed by group id, so the acted-on card chooses the group. */
function GroupActions({
  group,
  edit,
  remove,
  onDone,
}: {
  group: BookmarkGroup;
  edit: boolean;
  remove: boolean;
  onDone: () => void;
}) {
  const update = useUpdateGroup(group.id);
  const removal = useDeleteGroup(group.id);
  const toast = useToast();
  return (
    <>
      <GroupDialog
        open={edit}
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        existing={group}
        onSave={async (values) => {
          await update.mutateAsync(values);
          toast.show('Group saved', { tone: 'success' });
        }}
      />
      <ConfirmDialog
        open={remove}
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        title={`Remove the group “${group.name}”?`}
        description={
          group.bookmark_count
            ? `Its ${plural(group.bookmark_count, 'bookmark')} and their notes go with it. The runs stay.`
            : 'It holds no bookmark.'
        }
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async () => {
          try {
            await removal.mutateAsync();
            toast.show('Group removed', { tone: 'info' });
            onDone();
          } catch (e) {
            toast.show(actionErrorMessage('remove the group', e), { tone: 'error' });
          }
        }}
      />
    </>
  );
}

export function BookmarksPage() {
  const { slug, readOnly } = useProjectContext();
  useDocumentTitle('Bookmarks');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope: BookmarkScope = params.get('scope') === 'mine' ? 'mine' : 'all';
  const toast = useToast();
  const qc = useQueryClient();
  const list = useBookmarkGroups(slug, scope);
  const create = useCreateGroup(slug);
  const showSkeleton = useDelayedPending(list.isPending);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BookmarkGroup | null>(null);
  const [removing, setRemoving] = useState<BookmarkGroup | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);
  const groups = list.data?.groups ?? [];
  const mine = groups.filter((g) => g.is_mine);
  const pinned = mine.filter((g) => g.pinned).length;
  const acting = editing ?? removing;

  function setScope(next: BookmarkScope) {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === 'all') out.delete('scope');
        else out.set('scope', next);
        return out;
      },
      { replace: true },
    );
  }

  async function togglePin(group: BookmarkGroup) {
    setPinning(group.id);
    try {
      await updateGroup(group.id, { pinned: !group.pinned });
      await qc.invalidateQueries({ queryKey: bookmarkKeys.all });
    } catch (e) {
      toast.show(actionErrorMessage(group.pinned ? 'unpin the group' : 'pin the group', e), {
        tone: 'error',
      });
    } finally {
      setPinning(null);
    }
  }

  return (
    <div className={constrained} data-testid="bookmarks-page">
      <PageHeader
        title="Bookmarks"
        description="Runs you and the team saved, in groups. Open a group to see its runs as on the Runs page."
        meta={
          list.data
            ? [
                <span key="count">{plural(groups.length, 'group')}</span>,
                ...(pinned ? [<span key="pinned">{pinned} pinned</span>] : []),
              ]
            : []
        }
        actions={
          <>
            <SegmentedControl<BookmarkScope>
              label="Whose groups"
              value={scope}
              onChange={setScope}
              options={SCOPES}
            />
            {readOnly ? null : (
              <Button
                variant="primary"
                icon={<Icon name="plus" size={12} />}
                onPress={() => setCreating(true)}
                data-testid="new-group"
              >
                New group
              </Button>
            )}
          </>
        }
      />
      {list.isError ? (
        <ErrorState error={list.error} title="Couldn’t load the bookmarks" onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        showSkeleton ? (
          <Skeleton kind="lines" rows={6} label="Loading bookmarks" />
        ) : null
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Icon name="bookmark" size={20} />}
          title={scope === 'mine' ? 'You have no groups here yet' : 'No bookmarks yet'}
          body={
            <>
              Open a run and press{' '}
              <Text as="strong" weight={600}>
                Bookmark
              </Text>{' '}
              in its header to save it into a group with a note, or make a group here first. Groups with
              public bookmarks show to every member of the project.
            </>
          }
          action={
            readOnly ? undefined : (
              <Button variant="primary" onPress={() => setCreating(true)}>
                New group
              </Button>
            )
          }
          guide="/docs/platform-guide/run-detail"
        />
      ) : (
        <ul
          className={styles.grid}
          aria-label="Bookmark groups"
          data-stale={list.isPlaceholderData ? '' : undefined}
        >
          {groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              slug={slug}
              canEdit={g.is_mine && !readOnly}
              busy={pinning === g.id}
              onTogglePin={(group) => void togglePin(group)}
              onEdit={setEditing}
              onRemove={setRemoving}
            />
          ))}
        </ul>
      )}
      <GroupDialog
        open={creating}
        onOpenChange={setCreating}
        existing={null}
        onSave={async (values) => {
          const made = await create.mutateAsync(values);
          toast.show('Group created', { tone: 'success' });
          navigate(bookmarksPath(slug, made.id));
        }}
      />
      {acting ? (
        <GroupActions
          key={acting.id}
          group={acting}
          edit={Boolean(editing)}
          remove={Boolean(removing)}
          onDone={() => {
            setEditing(null);
            setRemoving(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default BookmarksPage;
