/**
 * /projects/:slug/bookmarks/:groupId — one bookmark group. The hero names the group, its owner and its size; the
 * owner pins, edits and removes it. Below, the group's runs in the runs table itself (RunsPage over the group's run
 * ids: the same columns, sort, filters, selection, compare and row actions as the Runs page), or the Notes view
 * (`?show=notes`): the bookmarks as cards with their notes, the caller's own with edit / move and remove.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, actionErrorMessage } from '@/lib/http';
import {
  useBookmarkGroup,
  useDeleteGroup,
  useRemoveBookmark,
  useSaveBookmark,
  useUpdateGroup,
  type Bookmark,
  type BookmarkGroupDetail,
  type BookmarkWrite,
} from '@/api/bookmarks';
import { useCrumbLabel } from '@/lib/crumb-label';
import { useDelayedPending } from '@/lib/pending';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { constrained } from '@/features/shell/layout';
import { RunsPage } from '@/features/runs-list/RunsPage';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Flag,
  Icon,
  IconButton,
  PageHeader,
  SegmentedControl,
  Skeleton,
  UserName,
  useToast,
} from '@/ui';
import { BookmarkCard, runLabel } from './BookmarkCard';
import { BookmarkDialog } from './BookmarkDialog';
import { GroupDialog } from './GroupDialog';
import { bookmarksPath } from './lib/route';
import styles from './BookmarksPage.module.css';

type Show = 'runs' | 'notes';
const SHOWS: { value: Show; label: string; title: string }[] = [
  { value: 'runs', label: 'Runs', title: 'The runs of this group, as on the Runs page' },
  { value: 'notes', label: 'Notes', title: 'The bookmarks and their notes' },
];

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The mutations of one bookmark's run: the hooks are keyed by run id, so the acted-on card chooses the run. */
function BookmarkActions({
  slug,
  bookmark,
  edit,
  remove,
  onDone,
}: {
  slug: string;
  bookmark: Bookmark;
  edit: boolean;
  remove: boolean;
  onDone: () => void;
}) {
  const save = useSaveBookmark(bookmark.run_id);
  const removal = useRemoveBookmark(bookmark.run_id);
  const toast = useToast();
  const runName = runLabel(bookmark);
  return (
    <>
      <BookmarkDialog
        open={edit}
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        slug={slug}
        runName={runName}
        existing={bookmark}
        onSave={async (values: Required<BookmarkWrite>) => {
          await save.mutateAsync(values);
          toast.show(values.group_id !== bookmark.group.id ? 'Bookmark moved' : 'Bookmark saved', {
            tone: 'success',
          });
        }}
        onRemove={async () => {
          await removal.mutateAsync();
          toast.show('Bookmark removed', { tone: 'info' });
        }}
      />
      <ConfirmDialog
        open={remove}
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        title={`Remove the bookmark of “${runName}”?`}
        description="The run stays; only your bookmark and its note go."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={async () => {
          try {
            await removal.mutateAsync();
            toast.show('Bookmark removed', { tone: 'info' });
            onDone();
          } catch (e) {
            toast.show(actionErrorMessage('remove the bookmark', e), { tone: 'error' });
          }
        }}
      />
    </>
  );
}

export function BookmarkGroupPage({ groupId }: { groupId: string }) {
  const { slug, project } = useProjectContext();
  const navigate = useNavigate();
  const detail = useBookmarkGroup(groupId);
  const group = detail.data;
  const showSkeleton = useDelayedPending(detail.isPending);
  useCrumbLabel(group?.name);
  useDocumentTitle(group ? `${group.name} · Bookmarks` : `${project.name} · Bookmarks`);
  const missing = detail.error instanceof ApiError && detail.error.status === 404;

  if (showSkeleton && !group)
    return (
      <div className={constrained}>
        <Skeleton kind="lines" rows={3} label="Loading the group" />
      </div>
    );
  if (detail.isError)
    return (
      <div className={constrained} data-testid="group-missing">
        <ErrorState
          error={detail.error}
          title={missing ? 'Bookmark group not found' : 'Couldn’t load the group'}
          message={
            missing
              ? 'No group has this id, or it holds no bookmark you may see. It may have been removed.'
              : undefined
          }
          onRetry={missing ? undefined : () => void detail.refetch()}
          parent={{ to: bookmarksPath(slug), label: 'Bookmarks' }}
        />
      </div>
    );
  if (!group) return null;
  return <GroupBody slug={slug} group={group} onRemoved={() => navigate(bookmarksPath(slug))} />;
}

function GroupBody({
  slug,
  group,
  onRemoved,
}: {
  slug: string;
  group: BookmarkGroupDetail;
  onRemoved: () => void;
}) {
  const { readOnly } = useProjectContext();
  const [params, setParams] = useSearchParams();
  const show: Show = params.get('show') === 'notes' ? 'notes' : 'runs';
  const toast = useToast();
  const update = useUpdateGroup(group.id);
  const removal = useDeleteGroup(group.id);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  const [removingBookmark, setRemovingBookmark] = useState<Bookmark | null>(null);
  const canEdit = group.is_mine && !readOnly;
  const acting = editingBookmark ?? removingBookmark;

  function setShow(next: Show) {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === 'runs') out.delete('show');
        else out.set('show', next);
        return out;
      },
      { replace: true },
    );
  }

  async function togglePin() {
    try {
      await update.mutateAsync({ pinned: !group.pinned });
      toast.show(group.pinned ? 'Group unpinned' : 'Group pinned', { tone: 'success' });
    } catch (e) {
      toast.show(actionErrorMessage(group.pinned ? 'unpin the group' : 'pin the group', e), {
        tone: 'error',
      });
    }
  }

  const empty = (
    <EmptyState
      compact
      title="No runs in this group yet"
      body={
        canEdit
          ? 'Open a run and press Bookmark in its header to file it here.'
          : 'The owner has not shared a bookmark here yet.'
      }
    />
  );

  return (
    <div className={show === 'runs' ? styles.groupPage : constrained} data-testid="bookmark-group-page">
      <PageHeader
        title={<span dir="auto">{group.name}</span>}
        description={group.description || 'A bookmark group.'}
        meta={[
          <span key="owner">
            <UserName id={group.owner.id} name={group.owner.display_name} email={group.owner.email} />
          </span>,
          <span key="count">{plural(group.bookmark_count, 'bookmark')}</span>,
          ...(group.pinned
            ? [
                <Flag key="pinned" tone="info" icon="pin">
                  Pinned
                </Flag>,
              ]
            : []),
          ...(group.is_mine
            ? []
            : [
                <Flag key="shared" icon="eye">
                  Shared with you
                </Flag>,
              ]),
        ]}
        actions={
          <>
            <SegmentedControl<Show> label="Show" value={show} onChange={setShow} options={SHOWS} />
            {canEdit ? (
              <>
                <Button
                  variant="neutral"
                  icon={<Icon name={group.pinned ? 'pin-off' : 'pin'} size={12} />}
                  onPress={() => void togglePin()}
                  loading={update.isPending}
                  aria-pressed={group.pinned}
                  data-testid="group-pin"
                >
                  {group.pinned ? 'Unpin' : 'Pin'}
                </Button>
                <IconButton
                  label="Edit group"
                  icon="edit"
                  tile
                  onPress={() => setEditing(true)}
                  data-testid="group-edit"
                />
                <IconButton
                  label="Remove group"
                  icon="trash"
                  tile
                  tone="danger"
                  onPress={() => setRemoving(true)}
                  data-testid="group-delete"
                />
              </>
            ) : null}
          </>
        }
      />
      {show === 'runs' ? (
        <RunsPage scope={{ runIds: group.run_ids, empty }} />
      ) : group.bookmarks.length === 0 ? (
        empty
      ) : (
        <ul className={styles.grid} aria-label="Bookmarks" data-testid="group-notes">
          {group.bookmarks.map((b) => (
            <BookmarkCard
              key={b.id}
              bookmark={b}
              slug={slug}
              canEdit={b.is_mine && !readOnly}
              onEdit={setEditingBookmark}
              onRemove={setRemovingBookmark}
            />
          ))}
        </ul>
      )}
      <GroupDialog
        open={editing}
        onOpenChange={setEditing}
        existing={group}
        onSave={async (values) => {
          await update.mutateAsync(values);
          toast.show('Group saved', { tone: 'success' });
        }}
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
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
            onRemoved();
          } catch (e) {
            toast.show(actionErrorMessage('remove the group', e), { tone: 'error' });
          }
        }}
      />
      {acting ? (
        <BookmarkActions
          key={acting.id}
          slug={slug}
          bookmark={acting}
          edit={Boolean(editingBookmark)}
          remove={Boolean(removingBookmark)}
          onDone={() => {
            setEditingBookmark(null);
            setRemovingBookmark(null);
          }}
        />
      ) : null}
    </div>
  );
}

export default BookmarkGroupPage;
