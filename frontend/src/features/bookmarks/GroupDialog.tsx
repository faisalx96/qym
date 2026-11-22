/**
 * The group editor: name and description, for a new group (Bookmarks page) or an existing one (its page). The editor
 * mounts while the dialog is open and unmounts when it closes, so every opening starts from the stored values.
 */
import { useState } from 'react';
import { GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX, type BookmarkGroup, type GroupWrite } from '@/api/bookmarks';
import { actionErrorMessage } from '@/lib/http';
import { Button, Dialog, TextField, Textarea } from '@/ui';
import styles from './BookmarkDialog.module.css';

export interface GroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: BookmarkGroup | null;
  onSave: (values: GroupWrite) => Promise<unknown>;
}

export function GroupDialog(props: GroupDialogProps) {
  return props.open ? <GroupEditor {...props} /> : null;
}

function GroupEditor({ onOpenChange, existing, onSave }: GroupDialogProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocker = !name.trim()
    ? 'Give the group a name'
    : name.trim().length > GROUP_NAME_MAX
      ? `A name has at most ${GROUP_NAME_MAX} characters`
      : description.length > GROUP_DESCRIPTION_MAX
        ? `A description has at most ${GROUP_DESCRIPTION_MAX} characters`
        : undefined;

  async function save() {
    if (busy || blocker) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), description: description.trim() });
      onOpenChange(false);
    } catch (e) {
      setError(actionErrorMessage(existing ? 'save the group' : 'create the group', e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      title={existing ? 'Edit group' : 'New group'}
      description="A group is your folder of bookmarks in this project. Other members see it once it holds a public bookmark."
      size="md"
      footer={
        <>
          <Button variant="neutral" size="md" onPress={() => onOpenChange(false)} isDisabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onPress={() => void save()}
            loading={busy}
            isDisabled={Boolean(blocker)}
            disabledReason={blocker}
            data-testid="group-save"
          >
            {existing ? 'Save' : 'Create group'}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="Release baselines"
          autoFocus
          width="100%"
          data-testid="group-name"
        />
        <Textarea
          label="Description"
          rows={3}
          value={description}
          onChange={setDescription}
          placeholder="What the runs in this group have in common"
          data-testid="group-description"
        />
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
