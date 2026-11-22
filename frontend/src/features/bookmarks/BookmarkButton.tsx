/**
 * The run header's Bookmark button: "Bookmark" opens the editor for a new bookmark, "Bookmarked" (filled glyph) edits
 * the caller's own; a count tile says how many other members left a public bookmark on the run. Hidden while the
 * project is read-only for the caller (a Viewer, an archived project, an exported snapshot), as every write control.
 */
import { useState } from 'react';
import { useRemoveBookmark, useRunBookmarks, useSaveBookmark } from '@/api/bookmarks';
import { useProjectContext } from '@/features/shell';
import { Button, CountTile, Icon, Tooltip, useToast } from '@/ui';
import { BookmarkDialog } from './BookmarkDialog';

export function BookmarkButton({ runId, runName }: { runId: string; runName: string }) {
  const { slug, readOnly, snapshot } = useProjectContext();
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const query = useRunBookmarks(runId, !snapshot);
  const save = useSaveBookmark(runId);
  const remove = useRemoveBookmark(runId);
  if (readOnly || snapshot) return null;
  const mine = query.data?.mine ?? null;
  const others = query.data?.others.length ?? 0;
  return (
    <>
      <Tooltip
        content={
          others
            ? `${others} other member${others === 1 ? '' : 's'} bookmarked this run`
            : mine
              ? `Edit your bookmark (in ${mine.group.name})`
              : 'Save this run to one of your bookmark groups'
        }
      >
        <Button
          size="sm"
          variant="neutral"
          onPress={() => setOpen(true)}
          icon={<Icon name="bookmark" size={12} />}
          aria-pressed={Boolean(mine)}
          data-testid="bookmark-button"
        >
          {mine ? 'Bookmarked' : 'Bookmark'}
          {others ? <CountTile>{others}</CountTile> : null}
        </Button>
      </Tooltip>
      <BookmarkDialog
        open={open}
        onOpenChange={setOpen}
        slug={slug}
        runName={runName}
        existing={mine}
        onSave={async (values) => {
          await save.mutateAsync(values);
          toast.show(mine ? 'Bookmark saved' : 'Run bookmarked', { tone: 'success' });
        }}
        onRemove={
          mine
            ? async () => {
                await remove.mutateAsync();
                toast.show('Bookmark removed', { tone: 'info' });
              }
            : undefined
        }
      />
    </>
  );
}
