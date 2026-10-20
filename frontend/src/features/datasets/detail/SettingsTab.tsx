/** Dataset → Settings tab (brief 07 §2.11): general, visibility (admins), danger zone. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeleteDataset, usePatchDataset, type Dataset } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import {
  Button,
  Checkbox,
  Chip,
  ConfirmDialog,
  SectionHeader,
  Text,
  TextField,
  Textarea,
  useToast,
  Card,
} from '@/ui';
import { catalogPath, datasetPath } from '../lib/route';
import { DELETE_RULE } from '../lib/versions';
import { AccessSection } from './AccessSection';
import styles from './SettingsTab.module.css';

export function SettingsTab({
  slug,
  dataset,
  readOnly,
  archived,
}: {
  slug: string;
  dataset: Dataset;
  /** archived project, or a reader who cannot modify this dataset */
  readOnly: boolean;
  archived: boolean;
}) {
  const patch = usePatchDataset(slug, dataset.slug);
  const del = useDeleteDataset(slug, dataset.slug);
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(dataset.name);
  const [description, setDescription] = useState(dataset.description ?? '');
  const [tags, setTags] = useState<string[]>(dataset.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPrivate, setConfirmPrivate] = useState<boolean | null>(null);

  const dirty =
    name !== dataset.name ||
    description !== (dataset.description ?? '') ||
    tags.join('\u0001') !== (dataset.tags ?? []).join('\u0001');

  function addTag() {
    const t = tagDraft.trim();
    if (!t) return;
    if (tags.some((x) => x.toLowerCase() === t.toLowerCase())) {
      setTagError(`“${t}” is already a tag.`);
      return;
    }
    setTags([...tags, t]);
    setTagDraft('');
    setTagError(null);
  }

  async function save() {
    try {
      const r = await patch.mutateAsync({ name: name.trim(), description: description.trim(), tags });
      toast.show('Settings saved', { tone: 'success' });
      if (r.dataset.slug !== dataset.slug)
        navigate(datasetPath(slug, r.dataset.slug, { tab: 'settings' }), { replace: true });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Save failed', { tone: 'error' });
    }
  }

  async function setPrivate(value: boolean) {
    try {
      await patch.mutateAsync({ private_test_set: value });
      toast.show(value ? 'Items are now hidden from non-admins' : 'Items are visible to the whole project', {
        tone: 'success',
      });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Could not change visibility', {
        tone: 'error',
      });
    }
  }

  return (
    <div className={styles.wrap} data-dataset-settings>
      <Card as="section" aria-labelledby="ds-general">
        <div className={styles.stack}>
          <SectionHeader id="ds-general" title="General" />
          <TextField label="Name" value={name} onChange={setName} isReadOnly={readOnly} isRequired />
          <Textarea
            label="Description"
            value={description}
            onChange={setDescription}
            rows={3}
            isReadOnly={readOnly}
          />
          <div className={styles.tags}>
            <TextField
              label="Tags"
              value={tagDraft}
              onChange={(v) => {
                setTagDraft(v);
                setTagError(null);
              }}
              isReadOnly={readOnly}
              placeholder="Type a tag and press Enter"
              help={tagError ? undefined : 'Press Enter to add a tag.'}
              errorMessage={tagError ?? undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
            />
            {tags.length ? (
              <div className={styles.chipRow} role="list" aria-label="Tags">
                {tags.map((t) => (
                  <Chip
                    key={t}
                    isSelected
                    onRemove={readOnly ? undefined : () => setTags(tags.filter((x) => x !== t))}
                    removeLabel={`Remove tag ${t}`}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
          {!readOnly ? (
            <div>
              <Button
                variant="primary"
                onPress={() => void save()}
                isDisabled={!dirty || !name.trim()}
                loading={patch.isPending}
              >
                Save changes
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      {dataset.can_set_private_test_set ? (
        <Card as="section" aria-labelledby="ds-visibility">
          <div className={styles.stack}>
            <SectionHeader
              id="ds-visibility"
              title="Visibility"
              description="A private test set hides its items from everyone except admins, including the inputs, expected outputs, outputs, and traces of runs evaluated on it. Members still see versions, run history, and scores."
            />
            <Checkbox
              isSelected={dataset.private_test_set}
              isDisabled={readOnly || patch.isPending}
              onChange={(v) => setConfirmPrivate(v)}
              data-testid="private-toggle"
            >
              Private test set (admins only)
            </Checkbox>
          </div>
        </Card>
      ) : null}

      <AccessSection slug={slug} dataset={dataset} archived={archived} />

      <Card as="section" aria-labelledby="ds-danger" tone="danger">
        <div className={styles.stack}>
          <SectionHeader
            id="ds-danger"
            title="Danger zone"
            description="Deleting moves the dataset, with all its versions, items and history, to Deleted datasets, where a project manager can restore it. Runs that used it keep their results."
          />
          {archived ? (
            <Text variant="sm" tone="muted">
              This project is archived.
            </Text>
          ) : dataset.permissions.can_delete ? (
            <div>
              <Button variant="danger" onPress={() => setConfirmDelete(true)} data-testid="delete-dataset">
                Delete dataset
              </Button>
            </div>
          ) : (
            <Text variant="sm" tone="muted">
              {DELETE_RULE}
            </Text>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${dataset.name}”?`}
        description={[
          'The dataset moves to Deleted datasets with every version and item.',
          'A project manager can restore it later.',
        ]}
        requireText={dataset.name}
        inputLabel={`Type ${dataset.name} to confirm`}
        confirmLabel="Delete dataset"
        tone="danger"
        onConfirm={async () => {
          try {
            await del.mutateAsync();
            toast.show(`“${dataset.name}” moved to Deleted datasets`, { tone: 'success' });
            navigate(catalogPath(slug));
          } catch (e) {
            toast.show(e instanceof ApiError ? e.detail || e.message : 'Delete failed', { tone: 'error' });
            throw e;
          }
        }}
      />
      <ConfirmDialog
        open={confirmPrivate !== null}
        onOpenChange={(o) => !o && setConfirmPrivate(null)}
        title={confirmPrivate ? 'Hide items from the team?' : 'Make items visible to the team?'}
        description={
          confirmPrivate
            ? 'Only admins will see item contents, run inputs, outputs and traces for this dataset. This takes effect immediately for everyone.'
            : 'Every project member will be able to read the items and the run outputs on this dataset.'
        }
        confirmLabel={confirmPrivate ? 'Hide items' : 'Make visible'}
        tone="accent"
        onConfirm={async () => {
          const value = Boolean(confirmPrivate);
          setConfirmPrivate(null);
          await setPrivate(value);
        }}
      />
    </div>
  );
}
