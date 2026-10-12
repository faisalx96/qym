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
import { ApiError } from '@/lib/http';
import { FormDialog, useToast, type FormValue } from '@/ui';
import { sniffJson } from '../lib/itemValue';
import { datasetPath } from '../lib/route';
import { slugifyDatasetName } from '../lib/slugify';
import { PRODUCTION_RULE } from '../lib/versions';

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.detail || e.message;
  return e instanceof Error ? e.message : String(e);
}

export function NewDatasetDialog({ open, onOpenChange, slug }: { open: boolean; onOpenChange: (o: boolean) => void; slug: string }) {
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
        { name: 'name', label: 'Name', required: true, autoFocus: true, placeholder: 'e.g. Support QA' },
        { name: 'slug', label: 'Slug', mono: true, placeholder: 'auto from the name', help: 'Letters and digits of any script; blank = generated.' },
        { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
      ]}
      onChange={(values, changed) => {
        if (changed === 'name' && !values.__slugTouched) return { ...values, slug: slugifyDatasetName(String(values.name ?? '')) };
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
          options: [{ value: '', label: 'Start empty' }, ...versions.map((v) => ({ value: v.version, label: `${v.version}${v.name ? ` — ${v.name}` : ''} (${v.status})` }))],
        },
      ]}
      onSubmit={async (values) => {
        try {
          const r = await create.mutateAsync({ name: String(values.name ?? '').trim() || undefined, from_version: String(values.from ?? '') || undefined });
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
      description={`Publishing freezes ${version.version} (${version.item_count.toLocaleString()} items) as a snapshot; runs can target it and it can no longer be edited.`}
      confirmLabel="Publish"
      submittingLabel="Publishing…"
      fields={
        canSetProduction
          ? [{ name: 'alias', label: 'Set as production', type: 'checkbox', value: true, help: dataset.production_version ? `Moves production from ${dataset.production_version.version}.` : undefined }]
          : [{ name: 'note', label: 'Production alias', type: 'text', value: PRODUCTION_RULE, help: 'You can publish; a manager sets the production alias.' }]
      }
      onSubmit={async (values) => {
        try {
          await publish.mutateAsync({ version: version.version, setAlias: canSetProduction && Boolean(values.alias) });
          toast.show(`${version.version} published`, { tone: 'success' });
        } catch (e) {
          return errorText(e);
        }
      }}
    />
  );
}

export function NameVersionDialog({ open, onOpenChange, slug, dataset, version }: { open: boolean; onOpenChange: (o: boolean) => void; slug: string; dataset: Dataset; version: DatasetVersion }) {
  const patch = usePatchVersion(slug, dataset.slug);
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Name ${version.version}`}
      confirmLabel="Save"
      fields={[{ name: 'name', label: 'Name', value: version.name ?? '', autoFocus: true, placeholder: 'e.g. “Q3 refresh”' }]}
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

export function AddItemDialog({
  open,
  onOpenChange,
  slug,
  dataset,
  version,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  onCreated?: (item: DatasetItem) => void;
}) {
  const create = useCreateItem(slug, dataset.slug, version.version);
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add item"
      description={`Added to draft ${version.version}. Input and Expected output are stored as JSON when they look like JSON ({ [ " numbers true false null), otherwise as text.`}
      size="lg"
      confirmLabel="Add item"
      submittingLabel="Adding…"
      fields={[
        { name: 'item_id', label: 'Item ID', mono: true, placeholder: `auto: item-${version.item_count + 1}` },
        { name: 'input', label: 'Input', type: 'textarea', required: true, rows: 4, autoFocus: true },
        { name: 'expected', label: 'Expected output', type: 'textarea', rows: 3 },
        {
          name: 'metadata',
          label: 'Metadata (JSON object)',
          type: 'textarea',
          rows: 2,
          mono: true,
          placeholder: '{}',
          validate: (v: FormValue) => {
            const t = String(v ?? '').trim();
            if (!t) return null;
            try {
              const parsed: unknown = JSON.parse(t);
              return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : 'Metadata must be a JSON object.';
            } catch {
              return 'Metadata is not valid JSON.';
            }
          },
        },
      ]}
      onSubmit={async (values) => {
        try {
          const metaText = String(values.metadata ?? '').trim();
          const r = await create.mutateAsync({
            item_id: String(values.item_id ?? '').trim() || undefined,
            input: sniffJson(String(values.input ?? '')),
            expected_output: String(values.expected ?? '').trim() ? sniffJson(String(values.expected)) : undefined,
            metadata: metaText ? (JSON.parse(metaText) as Record<string, unknown>) : undefined,
          });
          toast.show(`Item ${r.item.item_id} added`, { tone: 'success' });
          onCreated?.(r.item);
        } catch (e) {
          return errorText(e);
        }
      }}
    />
  );
}
