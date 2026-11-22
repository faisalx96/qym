/**
 * /projects/:slug/bookmarks — the runs people saved, with their notes. Pinned bookmarks lead (the server orders
 * them, newest pin first), then the newest bookmark. URL state: ?q= (run name, run id or note) and ?scope=mine.
 * A card grid page: search and the All | Mine control sit in the PageHeader actions (DESIGN_LANGUAGE §4).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  bookmarkKeys,
  saveBookmark,
  useProjectBookmarks,
  useRemoveBookmark,
  useSaveBookmark,
  type Bookmark,
  type BookmarkScope,
  type BookmarkWrite,
} from '@/api/bookmarks';
import { actionErrorMessage } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { constrained } from '@/features/shell/layout';
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  SearchField,
  SegmentedControl,
  Skeleton,
  Text,
  useToast,
} from '@/ui';
import { BookmarkCard, runLabel } from './BookmarkCard';
import { BookmarkDialog } from './BookmarkDialog';
import styles from './BookmarksPage.module.css';

const SCOPES: { value: BookmarkScope; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Your bookmarks and everyone’s public ones' },
  { value: 'mine', label: 'Mine', title: 'Only your bookmarks' },
];

function plural(n: number) {
  return `${n} bookmark${n === 1 ? '' : 's'}`;
}

/** The mutations of one bookmark's run: the hooks are keyed by run id, so the acting card chooses the run. */
function BookmarkActions({
  runId,
  edit,
  remove,
  onDone,
  runName,
}: {
  runId: string;
  edit: Bookmark | null;
  remove: Bookmark | null;
  onDone: () => void;
  runName: string;
}) {
  const save = useSaveBookmark(runId);
  const removal = useRemoveBookmark(runId);
  const toast = useToast();
  return (
    <>
      <BookmarkDialog
        open={Boolean(edit)}
        onOpenChange={(open) => {
          if (!open) onDone();
        }}
        runName={runName}
        existing={edit}
        onSave={async (values: Required<BookmarkWrite>) => {
          await save.mutateAsync(values);
          toast.show('Bookmark saved', { tone: 'success' });
        }}
        onRemove={async () => {
          await removal.mutateAsync();
          toast.show('Bookmark removed', { tone: 'info' });
        }}
      />
      <ConfirmDialog
        open={Boolean(remove)}
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

export function BookmarksPage() {
  const { slug, readOnly } = useProjectContext();
  useDocumentTitle('Bookmarks');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const scope: BookmarkScope = params.get('scope') === 'mine' ? 'mine' : 'all';
  const [search, setSearch] = useState(q);
  const toast = useToast();
  const list = useProjectBookmarks(slug, scope, q);
  const showSkeleton = useDelayedPending(list.isPending);
  // The card acted on: the editor or the remove question opens for it, and pin / unpin saves at once.
  const [editing, setEditing] = useState<Bookmark | null>(null);
  const [removing, setRemoving] = useState<Bookmark | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);
  const qc = useQueryClient();

  function setQuery(updates: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null || v === '') next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  }

  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setQuery({ q: search.trim() || null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, q]);

  const bookmarks = useMemo(() => list.data?.bookmarks ?? [], [list.data]);
  const pinned = bookmarks.filter((b) => b.pinned).length;
  const acting = editing ?? removing;

  async function togglePin(bookmark: Bookmark) {
    setPinning(bookmark.run_id);
    try {
      await saveBookmark(bookmark.run_id, { pinned: !bookmark.pinned });
      await qc.invalidateQueries({ queryKey: bookmarkKeys.all });
    } catch (e) {
      toast.show(actionErrorMessage(bookmark.pinned ? 'unpin the bookmark' : 'pin the bookmark', e), {
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
        description="Runs you and the team saved, with notes. Pinned bookmarks lead."
        meta={
          list.data
            ? [
                <span key="count">{plural(list.data.total)}</span>,
                ...(pinned ? [<span key="pinned">{pinned} pinned</span>] : []),
              ]
            : []
        }
        actions={
          <>
            <SearchField
              label="Search bookmarks"
              hideLabel
              placeholder="Run name, id or note"
              value={search}
              onChange={setSearch}
              onClear={() => setSearch('')}
              shortcut="/"
            />
            <SegmentedControl<BookmarkScope>
              label="Whose bookmarks"
              value={scope}
              onChange={(next) => setQuery({ scope: next === 'all' ? null : next })}
              options={SCOPES}
            />
          </>
        }
      />
      {list.isError ? (
        <ErrorState error={list.error} title="Couldn’t load the bookmarks" onRetry={() => list.refetch()} />
      ) : list.isPending ? (
        showSkeleton ? (
          <Skeleton kind="lines" rows={6} label="Loading bookmarks" />
        ) : null
      ) : bookmarks.length === 0 ? (
        q ? (
          <EmptyState compact title={`No bookmarks match “${q}”`} />
        ) : (
          <EmptyState
            icon={<Icon name="bookmark" size={20} />}
            title={scope === 'mine' ? 'You have no bookmarks here yet' : 'No bookmarks yet'}
            body={
              <>
                Open a run and press <Text as="strong" weight={600}>Bookmark</Text> in its header to save it
                here with a note. Public bookmarks show to every member of the project.
              </>
            }
            guide="/docs/platform-guide/run-detail"
          />
        )
      ) : (
        <ul className={styles.grid} aria-label="Bookmarks" data-stale={list.isPlaceholderData ? '' : undefined}>
          {bookmarks.map((b) => (
            <BookmarkCard
              key={b.id}
              bookmark={b}
              slug={slug}
              canEdit={b.is_mine && !readOnly}
              busy={pinning === b.run_id}
              onEdit={setEditing}
              onTogglePin={(bookmark) => void togglePin(bookmark)}
              onRemove={setRemoving}
            />
          ))}
        </ul>
      )}
      {acting ? (
        <BookmarkActions
          key={acting.id}
          runId={acting.run_id}
          runName={runLabel(acting)}
          edit={editing}
          remove={removing}
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
