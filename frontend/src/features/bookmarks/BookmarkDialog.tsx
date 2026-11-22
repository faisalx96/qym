/**
 * The one bookmark editor, from the run header and from a group's page: the group it is filed in (one of yours, or a
 * new one typed on the spot), the markdown note, and Private | Public. A form dialog keeps its action name as the
 * title (C146); Remove sits in the footer of an existing bookmark. The editor mounts when the dialog opens and
 * unmounts when it closes, so every opening starts from the stored bookmark (or empty), never from a stale draft.
 */
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  BOOKMARK_NOTE_MAX,
  DEFAULT_GROUP_NAME,
  GROUP_NAME_MAX,
  useBookmarkGroups,
  useCreateGroup,
  type Bookmark,
  type BookmarkVisibility,
  type BookmarkWrite,
} from '@/api/bookmarks';
import { APP_LOCALE } from '@/lib/dates';
import { actionErrorMessage } from '@/lib/http';
import { Button, Dialog, SegmentedControl, Select, TextField, Textarea } from '@/ui';
import styles from './BookmarkDialog.module.css';

const NEW = '__new';

export interface BookmarkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project, for the caller's groups. */
  slug: string;
  /** The run the bookmark is of, for the description line. */
  runName: string;
  /** The caller's bookmark when editing; null when creating one. */
  existing: Bookmark | null;
  /** The group a new bookmark starts in (a group's page); else the caller's General or first group. */
  defaultGroupId?: string | null;
  onSave: (values: Required<BookmarkWrite>) => Promise<unknown>;
  onRemove?: () => Promise<unknown>;
}

export function BookmarkDialog(props: BookmarkDialogProps) {
  return props.open ? <BookmarkEditor {...props} /> : null;
}

function BookmarkEditor({
  onOpenChange,
  slug,
  runName,
  existing,
  defaultGroupId,
  onSave,
  onRemove,
}: BookmarkDialogProps) {
  const groups = useBookmarkGroups(slug, 'mine');
  const createGroup = useCreateGroup(slug);
  const mine = groups.data?.groups ?? [];
  const [note, setNote] = useState(existing?.note ?? '');
  const [visibility, setVisibility] = useState<BookmarkVisibility>(existing?.visibility ?? 'private');
  const [chosen, setChosen] = useState<Key | null>(existing?.group.id ?? defaultGroupId ?? null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tooLong = note.length > BOOKMARK_NOTE_MAX;
  const limit = BOOKMARK_NOTE_MAX.toLocaleString(APP_LOCALE);
  // Without a choice: the General group, else the first; with none at all, a new group named General.
  const fallback = mine.find((g) => g.name === DEFAULT_GROUP_NAME)?.id ?? mine[0]?.id ?? null;
  const selected: Key | null =
    chosen && (chosen === NEW || mine.some((g) => g.id === chosen)) ? chosen : fallback;
  const creating = selected === NEW || (groups.isSuccess && mine.length === 0);
  const name = (creating && selected === NEW ? newName : DEFAULT_GROUP_NAME).trim();
  const blocker = tooLong
    ? `A note has at most ${limit} characters`
    : creating && !name
      ? 'Name the new group'
      : creating && name.length > GROUP_NAME_MAX
        ? `A group name has at most ${GROUP_NAME_MAX} characters`
        : undefined;
  const items = [
    ...mine.map((g) => ({
      key: g.id,
      label: g.name,
      description: `${g.bookmark_count} bookmark${g.bookmark_count === 1 ? '' : 's'}`,
    })),
    { key: NEW, label: 'New group', description: 'Type a name below' },
  ];

  async function save() {
    if (busy || blocker) return;
    setBusy('save');
    setError(null);
    try {
      let groupId = typeof selected === 'string' && selected !== NEW ? selected : null;
      if (creating) {
        const made = await createGroup.mutateAsync({ name, description: '' });
        groupId = made.id;
      }
      await onSave({ group_id: groupId ?? '', note, visibility });
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
            isDisabled={busy === 'remove' || Boolean(blocker)}
            disabledReason={blocker}
            data-testid="bookmark-save"
          >
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        {groups.isSuccess && mine.length === 0 ? (
          <p className={styles.hint} data-testid="bookmark-first-group">
            Your first bookmark here goes into a new group, {DEFAULT_GROUP_NAME}. Groups are renamed and made
            on the Bookmarks page.
          </p>
        ) : (
          <Select
            label="Group"
            items={items}
            value={selected}
            onChange={setChosen}
            searchable="auto"
            placeholder={groups.isPending ? 'Loading your groups' : 'Choose a group'}
            isDisabled={groups.isPending}
            width="100%"
            data-testid="bookmark-group"
          />
        )}
        {selected === NEW && mine.length > 0 ? (
          <TextField
            label="New group name"
            value={newName}
            onChange={setNewName}
            placeholder="Release baselines"
            autoFocus
            width="100%"
            data-testid="bookmark-new-group"
          />
        ) : null}
        <Textarea
          label="Note"
          rows={7}
          value={note}
          onChange={setNote}
          placeholder="Why this run matters, in markdown"
          help="Markdown: headings, lists, bold, links and code."
          errorMessage={
            tooLong
              ? `${note.length.toLocaleString(APP_LOCALE)} characters; the limit is ${limit}`
              : undefined
          }
          autoFocus={selected !== NEW}
          data-testid="bookmark-note"
        />
        <div className={styles.row}>
          <SegmentedControl<BookmarkVisibility>
            label="Visibility"
            value={visibility}
            onChange={setVisibility}
            options={[
              { value: 'private', label: 'Private', title: 'Only you see it' },
              {
                value: 'public',
                label: 'Public',
                title: 'Every member of the project sees it, with your name',
              },
            ]}
          />
        </div>
        <p className={styles.hint}>
          {visibility === 'public'
            ? 'Every member of the project sees this bookmark and your note, with your name, and the group it is in.'
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
