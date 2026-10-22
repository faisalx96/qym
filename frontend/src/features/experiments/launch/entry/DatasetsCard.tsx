import { useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import { useDatasetVersions } from '@/api/launch';
import type { LaunchDataset } from '@/api/launch';
import {
  Button,
  DropdownMenu,
  Icon,
  IconButton,
  MultiSelect,
  SegmentedControl,
  Select,
  Tag,
  Text,
} from '@/ui';
import {
  addDataset,
  datasetEntries,
  pairCount,
  pointerToFieldName,
  refLabel,
  removeDataset,
  setEntryRefs,
  setRunShape,
  type DatasetEntry,
  type RunShape,
} from '../model';
import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import {
  DATASET_CHIP_PRIVATE,
  DATASET_CHIP_RESTRICTED,
  DATASET_HELP_PRIVATE,
  DATASET_HELP_RESTRICTED,
} from '../copy';
import styles from './entry.module.css';

/** `Restricted` wins over `Private test set` when a dataset is both; `null` for a plain dataset. */
function chipOf(d: LaunchDataset | undefined): string | null {
  if (!d) return null;
  if (d.access_mode === 'restricted') return DATASET_CHIP_RESTRICTED;
  return d.private_test_set ? DATASET_CHIP_PRIVATE : null;
}

interface PickerItem {
  key: string;
  label: string;
  chip: string | null;
}

/** The name never truncates (it wraps); the chip follows it with a small gap. */
function PickerName({ item }: { item: PickerItem }) {
  return (
    <span className={styles.datasetName}>
      <span className={styles.datasetLabel}>{item.label}</span>
      {item.chip ? <Tag data-testid="dataset-chip">{item.chip}</Tag> : null}
    </span>
  );
}

export const SHAPE_HELP: Record<RunShape, (n: number) => string> = {
  combined: (n) =>
    `One run over the ${n} dataset versions together. Every item records its dataset and version, and scores break down per dataset.`,
  one_each: (n) => `${n} runs per environment, one per dataset version, grouped under this experiment.`,
};

/** `1 dataset version` / `4 dataset versions from 2 datasets`. */
export function pairCountText(pairs: number, datasets: number): string {
  if (pairs === 1) return '1 dataset version';
  return `${pairs} dataset versions from ${datasets} ${datasets === 1 ? 'dataset' : 'datasets'}`;
}

function DatasetBox({
  entry,
  chip,
  readOnly,
  index,
  onRemove,
  announce,
}: {
  entry: DatasetEntry;
  chip: string | null;
  readOnly: boolean;
  index: number;
  onRemove: () => void;
  announce: (text: string) => void;
}) {
  const { slug, setDoc, registerField } = useLaunch();
  const versions = useDatasetVersions(slug, entry.name);
  const items = useMemo(() => {
    const out: Array<{ key: string; label: string; draft?: boolean }> = [{ key: 'latest', label: 'Latest version' }];
    for (const v of versions.data?.versions ?? [])
      out.push({ key: `v:${v.version}`, label: `Version ${v.version}`, draft: v.status === 'draft' });
    for (const a of versions.data?.aliases ?? []) out.push({ key: `a:${a}`, label: `Alias ${a}` });
    // A base may carry a reference this list no longer shows: keep it selectable.
    for (const ref of entry.refs)
      if (ref && !out.some((o) => o.key === ref)) out.push({ key: ref, label: refLabel(ref) });
    return out;
  }, [versions.data, entry.refs]);
  const order = items.map((i) => (i.key === 'latest' ? '' : i.key));
  const value = new Set<Key>(entry.refs.map((r) => (r === '' ? 'latest' : r)));
  const onChange = (keys: Set<Key>) => {
    const refs = order.filter((ref) => keys.has(ref === '' ? 'latest' : ref));
    if (!refs.length) announce('1 dataset version: Latest version');
    setDoc((d) => setEntryRefs(d, entry.name, refs));
  };
  return (
    <li className={styles.dsBox} data-dataset-box={entry.name}>
      <span className={styles.dsName}>
        <span>{entry.name}</span>
        {chip ? <Tag data-testid="dataset-chip">{chip}</Tag> : null}
      </span>
      <IconButton
        label={`Remove ${entry.name}`}
        icon="close"
        isDisabled={readOnly}
        onPress={onRemove}
      />
      <div
        className={styles.dsRefs}
        ref={(el) => registerField(pointerToFieldName(`/evaluator/datasets/${index}`), el)}
      >
        <MultiSelect
          label="Versions"
          triggerLabel={`Versions of ${entry.name}`}
          items={items}
          value={value}
          onChange={onChange}
          searchable={false}
          selectAll={false}
          onlyAction={false}
          triggerVariant="bar"
          summary={(set) => String(set.size)}
          isDisabled={readOnly || versions.isPending}
          renderItem={(item) => (
            <span>
              {item.label}
              {(item as { draft?: boolean }).draft ? <> <Tag>draft</Tag></> : null}
            </span>
          )}
        />
        <span className={styles.refTags}>
          {entry.refs.map((ref) => (
            <Tag key={ref || 'latest'} kind="version">
              {refLabel(ref)}
            </Tag>
          ))}
        </span>
      </div>
    </li>
  );
}

/** The run shape: shown from two dataset versions. */
function RunShapeControl({ pairs }: { pairs: number }) {
  const { doc, setDoc, readOnly, registerField } = useLaunch();
  const shape = doc.selection.runShape;
  return (
    <div
      className={styles.shapeBlock}
      data-testid="run-shape"
      ref={(el) => registerField(pointerToFieldName('/evaluator/run_shape'), el)}
    >
      <SegmentedControl
        label="Run shape"
        value={shape}
        isDisabled={readOnly}
        onChange={(value) => setDoc((d) => setRunShape(d, value as RunShape))}
        options={[
          { value: 'combined', label: 'Combine into one run' },
          { value: 'one_each', label: 'One run each' },
        ]}
      />
      <p className={styles.help}>{SHAPE_HELP[shape](pairs)}</p>
    </div>
  );
}

/**
 * Datasets of the experiment: nothing chosen is today's single Select (one dataset on Latest stays two
 * clicks); from the first choice a box per dataset with its versions (Versions menu + the chosen references
 * as tags), "Add another dataset", and from two dataset versions the run shape.
 */
export function DatasetsCard() {
  const { doc, setDoc, datasetNames, datasets, readOnly, registerField } = useLaunch();
  const [polite, setPolite] = useState('');
  const entries = datasetEntries(doc);
  const pairs = pairCount(doc);
  const items = useMemo<PickerItem[]>(
    () => (datasets ?? []).map((d) => ({ key: d.name, label: d.name, chip: chipOf(d) })),
    [datasets],
  );
  const chipByName = (name: string) => items.find((i) => i.key === name)?.chip ?? null;
  const custom = doc.dataset.mode === 'custom' ? doc.dataset.custom.trim() : '';
  const firstWithChip = entries.map((e) => chipByName(e.name)).find(Boolean) ?? null;

  const customCallout = custom ? (
    <Callout tone="warning" title="A custom dataset">
      <div>
        <Text variant="base" as="span">
          The starting point uses the dataset{' '}
          <Text variant="base" as="span" mono>
            {custom}
          </Text>
          , which is not one of this project’s datasets.
        </Text>
      </div>
      <div>
        <Button
          size="sm"
          variant="neutral"
          onPress={() => setDoc((d) => ({ ...d, dataset: { mode: 'project', name: '', ref: '', custom: '' } }))}
        >
          Remove
        </Button>
      </div>
    </Callout>
  ) : null;

  if (!entries.length) {
    const chosen = items.find((i) => i.key === doc.dataset.name);
    return (
      <div className={styles.stack}>
        <div ref={(el) => registerField(pointerToFieldName('/evaluator/dataset'), el)}>
          <Select
            label="Dataset"
            items={items}
            value={null}
            renderItem={(item) => <PickerName item={item as PickerItem} />}
            isDisabled={readOnly || datasetNames == null}
            placeholder={
              datasetNames == null
                ? 'Loading datasets…'
                : items.length
                  ? 'Choose a dataset'
                  : 'No datasets in this project'
            }
            onChange={(key) => key != null && setDoc((d) => addDataset(d, String(key)))}
          />
        </div>
        {chosen?.chip ? (
          <p className={styles.help} data-testid="dataset-token-help">
            {chosen.chip === DATASET_CHIP_RESTRICTED ? DATASET_HELP_RESTRICTED : DATASET_HELP_PRIVATE}
          </p>
        ) : null}
        {customCallout}
        {datasetNames != null && !items.length && !custom ? (
          <p className={styles.help}>Add a dataset in the project’s Datasets page to run an experiment.</p>
        ) : null}
      </div>
    );
  }

  const chosenNames = new Set(entries.map((e) => e.name));
  const remaining = items.filter((i) => !chosenNames.has(i.key));
  return (
    <fieldset className={styles.fieldset} data-testid="datasets-fieldset">
      <legend className={styles.legend}>Datasets</legend>
      <ul className={styles.dsList}>
        {entries.map((entry, index) => (
          <DatasetBox
            key={entry.name}
            entry={entry}
            index={index}
            chip={chipByName(entry.name)}
            readOnly={readOnly}
            announce={setPolite}
            onRemove={() => setDoc((d) => removeDataset(d, entry.name))}
          />
        ))}
      </ul>
      {firstWithChip ? (
        <p className={styles.help} data-testid="dataset-token-help">
          {firstWithChip === DATASET_CHIP_RESTRICTED ? DATASET_HELP_RESTRICTED : DATASET_HELP_PRIVATE}
        </p>
      ) : null}
      <div
        className={styles.dsFoot}
        ref={(el) => registerField(pointerToFieldName('/evaluator/datasets'), el)}
      >
        <DropdownMenu
          label="Add another dataset"
          placement="bottom start"
          trigger={
            <Button
              size="sm"
              variant="neutral"
              icon={<Icon name="plus" />}
              isDisabled={readOnly || !remaining.length}
            >
              Add another dataset
            </Button>
          }
          items={remaining.map((i) => ({
            id: i.key,
            label: i.chip ? (
              <span className={styles.datasetName}>
                <span className={styles.datasetLabel}>{i.label}</span>
                <Tag>{i.chip}</Tag>
              </span>
            ) : (
              i.label
            ),
          }))}
          onAction={(id) => setDoc((d) => addDataset(d, id))}
        />
        <span className={styles.help} aria-live="polite" data-testid="pair-count">
          {polite && pairs === 1 ? polite : pairCountText(pairs, entries.length)}
        </span>
      </div>
      {pairs >= 2 ? <RunShapeControl pairs={pairs} /> : null}
      {customCallout}
    </fieldset>
  );
}
