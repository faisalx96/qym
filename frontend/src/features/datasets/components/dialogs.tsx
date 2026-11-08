/** Small dataset dialogs (brief 07 §2.2, §2.6, §2.8) built on FormDialog / ConfirmDialog. */
import { useNavigate } from 'react-router-dom';
import {
  useCreateDataset,
  useCreateItem,
  useCreateVersion,
  usePatchVersion,
  usePublishVersion,
  type Dataset,
  type DatasetItem,
  type DatasetVersion,
} from '@/api/datasets';
import { errorSentence, fieldErrorsOf } from '@/lib/http';
import { useRef, useState } from 'react';
import { Button, Dialog, FormDialog, Textarea, TextField, useToast } from '@/ui';
import { FieldEditor, fieldStatus, initialFieldState, type FieldState } from './FieldEditor';
import { Note } from './Note';
import { publishDisabledNote } from '../lib/itemState';
import { datasetPath } from '../lib/route';
import { slugifyDatasetName } from '../lib/slugify';
import { PRODUCTION_RULE } from '../lib/versions';

import styles from './dialogs.module.css';
import { APP_LOCALE } from '@/lib/dates';

/** One plain sentence (C181). */
function errorText(e: unknown): string {
  return errorSentence(e);
}

export function NewDatasetDialog({
  open,
  onOpenChange,
  slug,
  initialName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  /** Register: the name runs already used (C030). */
  initialName?: string;
}) {
  const create = useCreateDataset(slug);
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New dataset"
      description="Start with an empty dataset; add items by hand or import a file into its first draft."
      confirmLabel="Create dataset"
      submittingLabel="Creating…"
      fields={[
        {
          name: 'name',
          label: 'Name',
          required: true,
          autoFocus: true,
          placeholder: 'e.g. Support QA',
          value: initialName,
        },
        {
          name: 'slug',
          label: 'Slug',
          value: initialName ? slugifyDatasetName(initialName) : undefined,
          mono: true,
          placeholder: 'auto from the name',
          help: 'Letters and digits of any script; blank = generated.',
        },
        { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
      ]}
      onChange={(values, changed) => {
        if (changed === 'name' && !values.__slugTouched)
          return { ...values, slug: slugifyDatasetName(String(values.name ?? '')) };
        if (changed === 'slug') return { ...values, __slugTouched: true };
        return undefined;
      }}
      onSubmit={async (values) => {
        try {
          const r = await create.mutateAsync({
            name: String(values.name).trim(),
            slug: String(values.slug ?? '').trim() || undefined,
            description: String(values.description ?? '').trim() || undefined,
          });
          toast.show(`Dataset "${r.dataset.name}" created`, { tone: 'success' });
          navigate(datasetPath(slug, r.dataset.slug));
        } catch (e) {
          if (Object.keys(fieldErrorsOf(e)).length) throw e;
          return errorText(e);
        }
      }}
    />
  );
}

export function CreateDraftDialog({
  open,
  onOpenChange,
  slug,
  dataset,
  versions,
  current,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  dataset: Dataset;
  versions: DatasetVersion[];
  current: DatasetVersion | null;
  onCreated: (version: DatasetVersion) => void;
}) {
  const create = useCreateVersion(slug, dataset.slug);
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create draft"
      description="A draft copies the items of a version so you can edit, add and remove items before publishing."
      confirmLabel="Create draft"
      submittingLabel="Creating…"
      fields={[
        { name: 'name', label: 'Name', autoFocus: true, placeholder: 'Optional, e.g. “fix typos”' },
        {
          name: 'from',
          label: 'Copy items from',
          type: 'select',
          value: current?.version ?? '',
          options: [
            { value: '', label: 'Start empty' },
            ...versions.map((v) => ({
              value: v.version,
              label: `${v.version}${v.name ? ` — ${v.name}` : ''} (${v.status})`,
            })),
          ],
        },
      ]}
      onSubmit={async (values) => {
        try {
          const r = await create.mutateAsync({
            name: String(values.name ?? '').trim() || undefined,
            from_version: String(values.from ?? '') || undefined,
          });
          toast.show(`Draft ${r.version.version} created`, { tone: 'success' });
          onCreated(r.version);
        } catch (e) {
          return errorText(e);
        }
      }}
    />
  );
}

export function PublishDialog({
  open,
  onOpenChange,
  slug,
  dataset,
  version,
  canSetProduction,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  canSetProduction: boolean;
}) {
  const publish = usePublishVersion(slug, dataset.slug);
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Publish ${version.version}`}
      description={`Publishing freezes ${version.version} (${version.item_count.toLocaleString(APP_LOCALE)} items) as a snapshot; runs can target it and it can no longer be edited.`}
      notice={
        version.disabled_count > 0 ? (
          <Note tone="info" data-testid="publish-disabled-note">
            <span>{publishDisabledNote(version.disabled_count, version.version)}</span>
          </Note>
        ) : undefined
      }
      confirmLabel="Publish"
      submittingLabel="Publishing…"
      fields={
        canSetProduction
          ? [
              {
                name: 'alias',
                label: 'Set as production',
                type: 'checkbox',
                value: true,
                help: dataset.production_version
                  ? `Moves production from ${dataset.production_version.version}.`
                  : undefined,
              },
            ]
          : [
              {
                name: 'note',
                label: 'Production alias',
                type: 'text',
                value: PRODUCTION_RULE,
                help: 'You can publish; a manager sets the production alias.',
              },
            ]
      }
      onSubmit={async (values) => {
        try {
          await publish.mutateAsync({
            version: version.version,
            setAlias: canSetProduction && Boolean(values.alias),
          });
          toast.show(`${version.version} published`, { tone: 'success' });
        } catch (e) {
          return errorText(e);
        }
      }}
    />
  );
}

export function NameVersionDialog({
  open,
  onOpenChange,
  slug,
  dataset,
  version,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
}) {
  const patch = usePatchVersion(slug, dataset.slug);
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Name ${version.version}`}
      confirmLabel="Save"
      fields={[
        {
          name: 'name',
          label: 'Name',
          value: version.name ?? '',
          autoFocus: true,
          placeholder: 'e.g. “Q3 refresh”',
        },
      ]}
      onSubmit={async (values) => {
        try {
          await patch.mutateAsync({ version: version.version, name: String(values.name ?? '').trim() });
          toast.show('Version renamed', { tone: 'success' });
        } catch (e) {
          return errorText(e);
        }
      }}
    />
  );
}

/**
 * Add item (C063): Input and Expected output use the item pane's editor, with its stored-type tag and its Text / JSON
 * switch, Text by default. A value changes type only when the user picks JSON, so a typed "30" stays the text "30" and
 * "null" stays the text "null".
 */
export function AddItemDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  onCreated?: (item: DatasetItem) => void;
  /** The first Add item just made this draft (C116): the toast says so. */
  newDraft?: boolean;
}) {
  // Remount on every open so the fields reset.
  return props.open ? <AddItemDialogInner {...props} /> : null;
}

function AddItemDialogInner({
  open,
  onOpenChange,
  slug,
  dataset,
  version,
  onCreated,
  newDraft,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  onCreated?: (item: DatasetItem) => void;
  newDraft?: boolean;
}) {
  const create = useCreateItem(slug, dataset.slug, version.version);
  const toast = useToast();
  const [itemId, setItemId] = useState('');
  const [input, setInput] = useState<FieldState>(() => initialFieldState(''));
  const [expected, setExpected] = useState<FieldState>(() => initialFieldState(''));
  const [meta, setMeta] = useState<FieldState>({ mode: 'json', text: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const inputStatus = fieldStatus('', input);
    const expectedStatus = fieldStatus('', expected);
    const metaStatus = meta.text.trim() ? fieldStatus({}, meta, true) : null;
    const problem = !input.text.trim()
      ? 'Input is required.'
      : !inputStatus.ok
        ? 'Input is not valid JSON. Switch it to Text to save it as text.'
        : expected.text.trim() && !expectedStatus.ok
          ? 'Expected output is not valid JSON. Switch it to Text to save it as text.'
          : metaStatus && !metaStatus.ok
            ? metaStatus.error === 'Metadata must be a JSON object.'
              ? metaStatus.error
              : 'Metadata is not valid JSON.'
            : null;
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const r = await create.mutateAsync({
        item_id: itemId.trim() || undefined,
        input: inputStatus.value,
        expected_output: expected.text.trim() ? expectedStatus.value : undefined,
        metadata: metaStatus ? (metaStatus.value as Record<string, unknown>) : undefined,
      });
      if (newDraft)
        toast.show(`Draft ${version.version} created · item ${r.item.item_id} added`, { tone: 'success' });
      // repeated adds merge into one toast: "2 items added" (C143)
      else
        toast.show(`Item ${r.item.item_id} added`, {
          tone: 'success',
          merge: { key: 'item-added', text: (n) => `${n} items added` },
        });
      onCreated?.(r.item);
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add item"
      description={`Added to draft ${version.version}.`}
      size="lg"
      footer={
        <>
          <Button variant="neutral" size="md" onPress={() => onOpenChange(false)} isDisabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onPress={() => void submit()} loading={busy}>
            {busy ? 'Adding…' : 'Add item'}
          </Button>
        </>
      }
    >
      <div className={styles.addItem}>
        <TextField
          label="Item ID"
          mono
          value={itemId}
          onChange={setItemId}
          placeholder={`auto: item-${version.item_count + 1}`}
        />
        <FieldEditor label="Input" value="" editable state={input} onChange={setInput} compact />
        <FieldEditor
          label="Expected output"
          value=""
          editable
          state={expected}
          onChange={setExpected}
          compact
        />
        <FieldEditor label="Metadata" value={{}} editable jsonOnly state={meta} onChange={setMeta} compact />
        {error ? (
          <p className={styles.addItemError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

export const REASON_MAX = 500;

/**
 * Disable one item or several selected items (spec A2-29 to A2-35): a reason, a counter and an
 * error under the field. `onConfirm` throws with the server detail to keep the dialog open.
 */
export function DisableItemDialog({
  open,
  onOpenChange,
  itemId,
  count,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** a single item's id; leave out with `count` for selected rows */
  itemId?: string;
  count?: number;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const many = count !== undefined && count !== 1;
  const title = many ? `Disable ${count} items?` : `Disable item ${itemId ?? ''}?`;
  const body = many
    ? 'They stay in this draft and are left out of runs once it is published. You can enable them again in any draft.'
    : 'The item stays in this draft but is left out of runs once the draft is published. You can enable it again in any draft.';
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) {
          setReason('');
          setError(null);
        }
        onOpenChange(o);
      }}
      title={title}
      description={body}
      isKeyboardDismissDisabled={busy}
      dismissOnBackdrop={!busy}
      initialFocus={field}
      data-testid="da-modal"
      footer={
        <>
          <Button variant="neutral" size="md" onPress={() => onOpenChange(false)} isDisabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" size="md" loading={busy} onPress={() => void submit()}>
            {many ? `Disable ${count}` : 'Disable item'}
          </Button>
        </>
      }
    >
      <Textarea
        ref={field}
        label="Reason (optional)"
        rows={3}
        value={reason}
        onChange={(v) => setReason(v.slice(0, REASON_MAX))}
        maxLength={REASON_MAX}
        dir="auto"
        errorMessage={error ?? undefined}
        help={
          <span data-testid="reason-counter" className={styles.counter}>
            {reason.length} / {REASON_MAX}
          </span>
        }
      />
    </Dialog>
  );
}
