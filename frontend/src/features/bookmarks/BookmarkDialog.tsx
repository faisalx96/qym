/**
 * The one bookmark editor, from the run header and from the Bookmarks page: the markdown note, Private | Public and
 * Pinned. A form dialog keeps its action name as the title (C146); Remove sits in the footer of an existing bookmark.
 * The editor mounts when the dialog opens and unmounts when it closes, so every opening starts from the stored
 * bookmark (or empty), never from a stale draft, without an effect that resets state.
 */
import { useState } from 'react';
import { BOOKMARK_NOTE_MAX, type Bookmark, type BookmarkVisibility, type BookmarkWrite } from '@/api/bookmarks';
import { APP_LOCALE } from '@/lib/dates';
import { actionErrorMessage } from '@/lib/http';
import { Button, Dialog, SegmentedControl, Switch, Textarea } from '@/ui';
import styles from './BookmarkDialog.module.css';

export interface BookmarkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The run the bookmark is of, for the description line. */
  runName: string;
  /** The caller's bookmark when editing; null when creating one. */
  existing: Bookmark | null;
  onSave: (values: Required<BookmarkWrite>) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
}

export function BookmarkDialog(props: BookmarkDialogProps) {
  return props.open ? <BookmarkEditor {...props} /> : null;
}

function BookmarkEditor({ onOpenChange, runName, existing, onSave, onRemove }: BookmarkDialogProps) {
  const [note, setNote] = useState(existing?.note ?? '');
  const [visibility, setVisibility] = useState<BookmarkVisibility>(existing?.visibility ?? 'private');
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tooLong = note.length > BOOKMARK_NOTE_MAX;
  const limit = BOOKMARK_NOTE_MAX.toLocaleString(APP_LOCALE);

  async function save() {
    if (busy || tooLong) return;
    setBusy('save');
    setError(null);
    try {
      await onSave({ note, visibility, pinned });
      onOpenChange(false);
    } catch (e) {
      setError(actionErrorMessage('save the bookmark', e));
      setBusy(null);
    }
  }

  async function remove() {
    if (busy || !onRemove) return;
    setBusy('remove');
    setError(null);
    try {
      await onRemove();
      onOpenChange(false);
    } catch (e) {
      setError(actionErrorMessage('remove the bookmark', e));
      setBusy(null);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={existing ? 'Edit bookmark' : 'Bookmark run'}
      description={runName}
      size="md"
      footer={
        <>
          {existing && onRemove ? (
            <Button
              variant="danger"
              size="md"
              onPress={() => void remove()}
              loading={busy === 'remove'}
              isDisabled={busy === 'save'}
              data-testid="bookmark-remove"
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </Button>
          ) : null}
          <Button variant="neutral" size="md" onPress={() => onOpenChange(false)} isDisabled={Boolean(busy)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onPress={() => void save()}
            loading={busy === 'save'}
            isDisabled={busy === 'remove' || tooLong}
            disabledReason={tooLong ? `A note has at most ${limit} characters` : undefined}
            data-testid="bookmark-save"
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <Textarea
          label="Note"
          rows={8}
          value={note}
          onChange={setNote}
          placeholder="Why this run matters, in markdown"
          help="Markdown: headings, lists, bold, links and code."
          errorMessage={
            tooLong ? `${note.length.toLocaleString(APP_LOCALE)} characters; the limit is ${limit}` : undefined
          }
          autoFocus
          data-testid="bookmark-note"
        />
        <div className={styles.row}>
          <SegmentedControl<BookmarkVisibility>
            label="Visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'private', label: 'Private', title: 'Only you see it' },
              { value: 'public', label: 'Public', title: 'Every member of the project sees it, with your name' },
            ]}
          />
          <Switch isSelected={pinned} onChange={setPinned} data-testid="bookmark-pinned">
            Pinned to the top
          </Switch>
        </div>
        <p className={styles.hint}>
          {visibility === 'public'
            ? 'Every member of the project sees this bookmark and your note, with your name.'
            : 'Only you see this bookmark.'}
        </p>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
