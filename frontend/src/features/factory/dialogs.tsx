/**
 * The factory's form dialogs: connect a dataset, write or edit a rule category, write or edit a rule, and start a
 * generation. Each editor mounts while its dialog is open and unmounts when it closes, so every opening starts from
 * the stored values without an effect that resets state (the bookmark dialog pattern). Form dialogs keep their
 * action name as the title; a question title is for decisions (C146).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import { useDatasetCatalog } from '@/api/datasets';
import {
  type CategoryWrite,
  type FactoryCategory,
  type FactoryDetail,
  type FactoryRule,
  type GenerationParams,
  type RuleKind,
  type RuleWrite,
} from '@/api/factory';
import { useLlmConnections } from '@/api/projectSettings';
import { APP_LOCALE } from '@/lib/dates';
import { actionErrorMessage } from '@/lib/http';
import {
  Button,
  Dialog,
  InlineNotice,
  NumberField,
  SegmentedControl,
  Select,
  Switch,
  Text,
  TextField,
  Textarea,
  ToggleChips,
} from '@/ui';
import styles from './FactoryDialogs.module.css';

const NONE = '__none';

function Footer({
  onCancel,
  onSubmit,
  busy,
  label,
  disabledReason,
  tone = 'primary',
}: {
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
  label: string;
  disabledReason?: string;
  tone?: 'primary' | 'accent';
}) {
  return (
    <>
      <Button size="md" variant="neutral" onPress={onCancel} isDisabled={busy}>
        Cancel
      </Button>
      <Button
        size="md"
        variant={tone}
        onPress={onSubmit}
        loading={busy}
        isDisabled={Boolean(disabledReason)}
        disabledReason={disabledReason}
        data-testid="factory-dialog-submit"
      >
        {label}
      </Button>
    </>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <InlineNotice tone="danger" lead="Failed." data-testid="factory-dialog-error">
      {error}
    </InlineNotice>
  ) : null;
}

/** `{...}` text → object, or the problem sentence. */
export function parseJsonObject(text: string): {
  value: Record<string, unknown> | null;
  error: string | null;
} {
  const raw = text.trim();
  if (!raw) return { value: null, error: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return { value: null, error: 'Write a JSON object, such as {"type": "object"}.' };
    return { value: parsed as Record<string, unknown>, error: null };
  } catch {
    return { value: null, error: 'This is not valid JSON.' };
  }
}

// ── Connect a dataset ───────────────────────────────────────────────────────

export interface ConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  projectId: string;
  connectedDatasetIds: string[];
  onConnect: (body: {
    dataset_ref: string;
    group_metadata_key: string | null;
    llm_connection_id: string | null;
  }) => Promise<unknown>;
}

export function ConnectDialog(props: ConnectDialogProps) {
  return props.open ? <ConnectEditor {...props} /> : null;
}

function ConnectEditor({
  onOpenChange,
  slug,
  projectId,
  connectedDatasetIds,
  onConnect,
}: ConnectDialogProps) {
  const catalog = useDatasetCatalog(slug);
  const connections = useLlmConnections(projectId);
  const [datasetRef, setDatasetRef] = useState<Key | null>(null);
  const [groupKey, setGroupKey] = useState('');
  const [connection, setConnection] = useState<Key | null>(NONE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = useMemo(
    () =>
      (catalog.data?.datasets ?? []).filter(
        (d) => d.permissions.can_modify && !d.private_test_set && !connectedDatasetIds.includes(d.id),
      ),
    [catalog.data, connectedDatasetIds],
  );

  async function submit() {
    if (!datasetRef || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConnect({
        dataset_ref: String(datasetRef),
        group_metadata_key: groupKey.trim() || null,
        llm_connection_id: connection && connection !== NONE ? String(connection) : null,
      });
      onOpenChange(false);
    } catch (e) {
      setError(actionErrorMessage('connect the dataset', e));
      setBusy(false);
    }
  }

  const noCandidates = catalog.data && candidates.length === 0;
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Connect a dataset"
      description="The factory reads the dataset's production version (else its newest published one) and extracts the business rules its items follow."
      footer={
        <Footer
          onCancel={() => onOpenChange(false)}
          onSubmit={() => void submit()}
          busy={busy}
          label="Connect"
          disabledReason={!datasetRef ? 'Choose a dataset first' : undefined}
        />
      }
    >
      <div className={styles.body} data-testid="connect-dialog">
        <Select
          label="Dataset"
          items={candidates.map((d) => ({
            key: d.slug,
            label: d.name,
            description: d.production_version
              ? `${d.production_version.version} · ${d.production_version.item_count.toLocaleString(APP_LOCALE)} items`
              : 'No published version yet',
          }))}
          value={datasetRef}
          onChange={setDatasetRef}
          placeholder={catalog.isPending ? 'Loading datasets…' : 'Choose a dataset'}
          isDisabled={catalog.isPending || Boolean(noCandidates)}
          help={
            noCandidates
              ? 'Every dataset you may modify is connected already, or is a private test set.'
              : 'Datasets you may modify. Private test sets cannot be connected.'
          }
          width="100%"
        />
        <TextField
          label="Group rules by metadata key"
          value={groupKey}
          onChange={setGroupKey}
          placeholder="topic"
          help="The item metadata key whose value groups the rules, such as topic or intent. Optional; the Settings tab lists the keys once connected."
          width="100%"
        />
        <Select
          label="Model"
          items={[
            { key: NONE, label: 'Project default connection' },
            ...(connections.data ?? []).map((c) => ({ key: c.id, label: c.name, description: c.llm_model })),
          ]}
          value={connection}
          onChange={setConnection}
          searchable={false}
          width="100%"
        />
        <ErrorLine error={error} />
      </div>
    </Dialog>
  );
}

// ── Rule category ───────────────────────────────────────────────────────────

export interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: FactoryCategory | null;
  onSave: (values: CategoryWrite) => Promise<unknown>;
}

export function CategoryDialog(props: CategoryDialogProps) {
  return props.open ? <CategoryEditor {...props} /> : null;
}

function CategoryEditor({ onOpenChange, existing, onSave }: CategoryDialogProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [schema, setSchema] = useState(
    existing?.json_schema ? JSON.stringify(existing.json_schema, null, 2) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseJsonObject(schema);
  const blocker = !name.trim()
    ? 'Give the category a name'
    : parsed.error
      ? 'Fix the schema first'
      : undefined;

  async function submit() {
    if (busy || blocker) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: name.trim(), description: description.trim(), json_schema: parsed.value });
      onOpenChange(false);
    } catch (e) {
      setError(actionErrorMessage(existing ? 'save the category' : 'add the category', e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={existing ? 'Edit category' : 'Add category'}
      description="A kind of rule the agent looks for. The description tells it what counts; a JSON schema makes every rule carry a structured body."
      size="lg"
      footer={
        <Footer
          onCancel={() => onOpenChange(false)}
          onSubmit={() => void submit()}
          busy={busy}
          label={existing ? 'Save' : 'Add category'}
          disabledReason={blocker}
        />
      }
    >
      <div className={styles.body} data-testid="category-dialog">
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          placeholder="Pricing constraints"
          autoFocus
          width="100%"
          data-testid="category-name"
        />
        <Textarea
          label="Description for the agent"
          value={description}
          onChange={setDescription}
          rows={4}
          placeholder="Rules about amounts, currencies and discounts that an answer must respect."
          data-testid="category-description"
        />
        <Textarea
          label="Rule body JSON schema"
          value={schema}
          onChange={setSchema}
          rows={8}
          mono
          spellCheck={false}
          placeholder={
            '{"type": "object", "required": ["field"], "properties": {"field": {"type": "string"}}}'
          }
          help="Optional. When set, every rule of this category carries a body that follows it (strictly checked); the agent fills it."
          errorMessage={parsed.error ?? undefined}
          data-testid="category-schema"
        />
        <ErrorLine error={error} />
      </div>
    </Dialog>
  );
}

// ── Rule ────────────────────────────────────────────────────────────────────

export interface RuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factory: FactoryDetail;
  groups: string[];
  existing: FactoryRule | null;
  onSave: (values: RuleWrite) => Promise<unknown>;
}

export function RuleDialog(props: RuleDialogProps) {
  return props.open ? <RuleEditor {...props} /> : null;
}

function RuleEditor({ onOpenChange, factory, groups, existing, onSave }: RuleDialogProps) {
  const [categoryId, setCategoryId] = useState<Key | null>(
    existing?.category_id ?? factory.categories[0]?.id ?? null,
  );
  const [group, setGroup] = useState(existing?.group_value ?? '');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [body, setBody] = useState(existing?.body ? JSON.stringify(existing.body, null, 2) : '');
  const [kind, setKind] = useState<RuleKind>(existing?.kind ?? 'rule');
  const [extraIds, setExtraIds] = useState<string[]>(
    (existing?.categories ?? []).map((c) => c.id).filter((id) => id !== existing?.category_id),
  );
  const [bridgeIds, setBridgeIds] = useState<string[]>((existing?.bridge_to ?? []).map((c) => c.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const category = factory.categories.find((c) => c.id === categoryId) ?? null;
  const parsed = parseJsonObject(body);
  const needsBody = Boolean(category?.json_schema);
  const primary = categoryId ? String(categoryId) : null;
  const others = factory.categories.filter((c) => c.id !== primary);
  const own = new Set([primary, ...extraIds]);
  const targets = factory.categories.filter((c) => !own.has(c.id));
  const chosenBridges = bridgeIds.filter((id) => targets.some((c) => c.id === id));
  const blocker = !categoryId
    ? 'Choose a category'
    : !title.trim()
      ? 'Give the rule a title'
      : kind === 'bridge' && !chosenBridges.length
        ? 'Choose a category the bridge opens'
        : parsed.error
          ? 'Fix the body first'
          : needsBody && !parsed.value
            ? 'This category needs a rule body'
            : undefined;
  const listId = 'factory-rule-groups';

  async function submit() {
    if (busy || blocker || !categoryId) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        category_id: String(categoryId),
        category_ids: extraIds.filter((id) => id !== String(categoryId)),
        kind,
        bridge_to_category_ids: kind === 'bridge' ? chosenBridges : [],
        group_value: group.trim(),
        title: title.trim(),
        description: description.trim(),
        body: parsed.value,
      });
      onOpenChange(false);
    } catch (e) {
      setError(actionErrorMessage(existing ? 'save the rule' : 'add the rule', e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={existing ? 'Edit rule' : 'Add rule'}
      description={
        existing?.official
          ? 'An official rule edited without the approve level goes back to proposed.'
          : 'A rule starts as proposed; someone with the approve level makes it official.'
      }
      size="lg"
      footer={
        <Footer
          onCancel={() => onOpenChange(false)}
          onSubmit={() => void submit()}
          busy={busy}
          label={existing ? 'Save' : 'Add rule'}
          disabledReason={blocker}
        />
      }
    >
      <div className={styles.body} data-testid="rule-dialog">
        <div className={styles.row}>
          <Select
            label="Category"
            items={factory.categories.map((c) => ({
              key: c.id,
              label: c.name,
              description: c.json_schema ? 'With a body schema' : undefined,
            }))}
            value={categoryId}
            onChange={setCategoryId}
            searchable={false}
            width="100%"
          />
          <TextField
            label={factory.group_metadata_key ? `Group (${factory.group_metadata_key})` : 'Group'}
            value={group}
            onChange={setGroup}
            placeholder="Empty = every item"
            list={listId}
            help="The metadata value the rule applies to. Empty applies to every item."
            width="100%"
          />
          <datalist id={listId}>
            {groups.filter(Boolean).map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </div>
        {others.length ? (
          <div className={styles.chips}>
            <Text as="span" variant="sm" tone="muted" id="rule-extra-categories">
              Also in
            </Text>
            <ToggleChips
              aria-labelledby="rule-extra-categories"
              options={others.map((c) => ({ value: c.id, label: c.name }))}
              value={extraIds.filter((id) => id !== primary)}
              onChange={setExtraIds}
              size="sm"
            />
          </div>
        ) : null}
        <SegmentedControl<RuleKind>
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'rule', label: 'Rule', title: 'Constrains the answer of an item' },
            { value: 'bridge', label: 'Bridge', title: 'Extends an item into other categories' },
          ]}
          data-testid="rule-kind"
        />
        {kind === 'bridge' ? (
          <div className={styles.chips}>
            <Text as="span" variant="sm" tone="muted" id="rule-bridge-targets">
              Bridges into
            </Text>
            {targets.length ? (
              <ToggleChips
                aria-labelledby="rule-bridge-targets"
                options={targets.map((c) => ({ value: c.id, label: c.name }))}
                value={chosenBridges}
                onChange={setBridgeIds}
                size="sm"
              />
            ) : (
              <Text as="span" variant="sm" tone="muted">
                Every category is already the rule’s own. Add a category first.
              </Text>
            )}
            <Text as="p" variant="sm" tone="muted" className={styles.help}>
              In generation, an item that carries this rule can take rules of these categories next: a join in
              a query, a second product in a conversation.
            </Text>
          </div>
        ) : null}
        <TextField
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="Amounts are in SAR"
          autoFocus
          width="100%"
          data-testid="rule-title"
        />
        <Textarea
          label="Rule"
          value={description}
          onChange={setDescription}
          rows={4}
          placeholder="Every amount in the answer is stated in Saudi riyals, with the SAR code."
          data-testid="rule-description"
        />
        <Textarea
          label={needsBody ? 'Body, following the category schema' : 'Body, a JSON object'}
          value={body}
          onChange={setBody}
          rows={6}
          mono
          spellCheck={false}
          errorMessage={parsed.error ?? undefined}
          help={category?.json_schema ? <JsonHint schema={category.json_schema} /> : undefined}
          data-testid="rule-body"
        />
        <ErrorLine error={error} />
      </div>
    </Dialog>
  );
}

function JsonHint({ schema }: { schema: Record<string, unknown> }): ReactNode {
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]).map(String) : [];
  return required.length ? `Required keys: ${required.join(', ')}` : 'Follows the category schema.';
}

// ── Generation ──────────────────────────────────────────────────────────────

export interface GenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  factory: FactoryDetail;
  groups: string[];
  onStart: (params: GenerationParams) => Promise<unknown>;
}

export function GenerateDialog(props: GenerateDialogProps) {
  return props.open ? <GenerateEditor {...props} /> : null;
}

function GenerateEditor({ onOpenChange, factory, groups, onStart }: GenerateDialogProps) {
  const limits = factory.generation_limits;
  const [maxLayers, setMaxLayers] = useState(limits.defaults.max_layers);
  const [branching, setBranching] = useState(limits.defaults.branching);
  const [maxItems, setMaxItems] = useState(limits.defaults.max_items);
  const [officialOnly, setOfficialOnly] = useState(limits.defaults.official_only);
  const [group, setGroup] = useState<Key | null>(NONE);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const official = factory.counts.official_rules;
  const total = factory.counts.rules;
  const noRules = officialOnly ? official === 0 : total === 0;
  const items = factory.source_version?.item_count ?? 0;
  const invalid =
    !Number.isInteger(maxLayers) || maxLayers < 1 || maxLayers > limits.max_layers
      ? `Layers go from 1 to ${limits.max_layers}`
      : !Number.isInteger(branching) || branching < 1 || branching > limits.max_branching
        ? `Variations go from 1 to ${limits.max_branching}`
        : !Number.isInteger(maxItems) || maxItems < 1 || maxItems > limits.max_items
          ? `The item cap goes from 1 to ${limits.max_items.toLocaleString(APP_LOCALE)}`
          : undefined;
  const blocker =
    invalid ??
    (noRules
      ? officialOnly
        ? 'No official rule yet: approve rules or allow proposed ones'
        : 'No rule yet: run the analysis first'
      : undefined);
  // The most items the tree can hold: sum over layers of items × variations^layer, capped.
  const ceiling = useMemo(() => {
    let sum = 0;
    let layer = items;
    for (let n = 1; n <= maxLayers; n += 1) {
      layer *= branching;
      sum += layer;
      if (sum > maxItems) return maxItems;
    }
    return Math.min(sum, maxItems);
  }, [items, maxLayers, branching, maxItems]);

  async function submit() {
    if (busy || blocker) return;
    setBusy(true);
    setError(null);
    try {
      await onStart({
        max_layers: maxLayers,
        branching,
        max_items: maxItems,
        official_only: officialOnly,
        group_values: group && group !== NONE ? [String(group)] : null,
        dataset_name: name.trim() || null,
      });
      onOpenChange(false);
    } catch (e) {
      setError(actionErrorMessage('start the generation', e));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title="Generate data"
      description="Each layer adds one more rule to an item: layer 1 items carry one rule, layer 2 items two. The new items land in a new draft dataset of this project."
      size="lg"
      footer={
        <Footer
          onCancel={() => onOpenChange(false)}
          onSubmit={() => void submit()}
          busy={busy}
          label="Start generation"
          disabledReason={blocker}
        />
      }
    >
      <div className={styles.body} data-testid="generate-dialog">
        <div className={styles.row}>
          <NumberField
            label="Max layers"
            value={maxLayers}
            onChange={setMaxLayers}
            minValue={1}
            maxValue={limits.max_layers}
            step={1}
            width={140}
            help="Rules per item, at most"
          />
          <NumberField
            label="Variations per item and layer"
            value={branching}
            onChange={setBranching}
            minValue={1}
            maxValue={limits.max_branching}
            step={1}
            width={140}
            help="Rules tried on each item"
          />
          <NumberField
            label="Item cap"
            value={maxItems}
            onChange={setMaxItems}
            minValue={1}
            maxValue={limits.max_items}
            step={50}
            width={140}
            help="The job stops there"
          />
        </div>
        <Text as="p" variant="sm" tone="muted" data-testid="generate-estimate">
          {items.toLocaleString(APP_LOCALE)} base items
          {factory.source_version ? ` (${factory.source_version.version})` : ''}, up to{' '}
          {ceiling.toLocaleString(APP_LOCALE)} generated items
          {officialOnly
            ? `, ${official} official rule${official === 1 ? '' : 's'}`
            : `, ${total} rule${total === 1 ? '' : 's'}`}
          .
        </Text>
        <Switch isSelected={officialOnly} onChange={setOfficialOnly} data-testid="generate-official-only">
          Official rules only
        </Switch>
        <div className={styles.row}>
          <Select
            label="Groups"
            items={[
              { key: NONE, label: 'Every group' },
              ...groups.map((g) => ({ key: g || '', label: g || 'Ungrouped' })),
            ]}
            value={group}
            onChange={setGroup}
            searchable={false}
            width="100%"
          />
          <TextField
            label="Dataset name"
            value={name}
            onChange={setName}
            placeholder={`${factory.dataset?.name ?? 'Dataset'} generated 1`}
            width="100%"
          />
        </div>
        <ErrorLine error={error} />
      </div>
    </Dialog>
  );
}
