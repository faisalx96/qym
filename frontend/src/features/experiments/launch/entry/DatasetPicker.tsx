import { useMemo } from 'react';
import { useDatasetVersions } from '@/api/launch';
import { Button, Select, Tag, Text } from '@/ui';
import type { LaunchDataset } from '@/api/launch';
import { pointerToFieldName } from '../model';
import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import {
  DATASET_CHIP_PRIVATE,
  DATASET_CHIP_RESTRICTED,
  DATASET_HELP_PRIVATE,
  DATASET_HELP_RESTRICTED,
} from '../copy';
import styles from './entry.module.css';

const LATEST = '__latest';

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

/** Project dataset + version/alias, and the callout for a dataset string a starting point carried. */
export function DatasetPicker() {
  const { doc, setDoc, slug, datasetNames, datasets, readOnly, registerField } = useLaunch();
  const name = doc.dataset.mode === 'project' ? doc.dataset.name : '';
  const versions = useDatasetVersions(slug, name || undefined);
  const items = useMemo<PickerItem[]>(
    () => (datasets ?? []).map((d) => ({ key: d.name, label: d.name, chip: chipOf(d) })),
    [datasets],
  );
  const chosen = items.find((i) => i.key === name);
  const refItems = useMemo(() => {
    const out = [{ key: LATEST, label: 'Latest version' }];
    for (const v of versions.data?.versions ?? [])
      out.push({ key: `v:${v.version}`, label: `Version ${v.version}` });
    for (const a of versions.data?.aliases ?? []) out.push({ key: `a:${a}`, label: `Alias ${a}` });
    // A base may carry a version this list no longer shows: keep it selectable.
    if (doc.dataset.ref && !out.some((o) => o.key === doc.dataset.ref))
      out.push({ key: doc.dataset.ref, label: doc.dataset.ref.slice(2) });
    return out;
  }, [versions.data, doc.dataset.ref]);
  const custom = doc.dataset.mode === 'custom' ? doc.dataset.custom.trim() : '';
  return (
    <div className={styles.stack}>
      <div ref={(el) => registerField(pointerToFieldName('/evaluator/dataset'), el)}>
        <Select
          label="Dataset"
          items={items}
          value={name || null}
          renderItem={(item) => <PickerName item={item as PickerItem} />}
          isDisabled={readOnly || datasetNames == null}
          placeholder={
            datasetNames == null
              ? 'Loading datasets…'
              : items.length
                ? 'Choose a dataset'
                : 'No datasets in this project'
          }
          onChange={(key) =>
            key != null &&
            setDoc((d) => ({ ...d, dataset: { mode: 'project', name: String(key), ref: '', custom: '' } }))
          }
        />
      </div>
      {chosen?.chip ? (
        <p className={styles.help} data-testid="dataset-token-help">
          {chosen.chip === DATASET_CHIP_RESTRICTED ? DATASET_HELP_RESTRICTED : DATASET_HELP_PRIVATE}
        </p>
      ) : null}
      {name ? (
        <div ref={(el) => registerField(pointerToFieldName('/evaluator/dataset_version'), el)}>
          <Select
            label="Dataset version"
            items={refItems}
            value={doc.dataset.ref || LATEST}
            isDisabled={readOnly || versions.isPending}
            onChange={(key) =>
              key != null &&
              setDoc((d) => ({ ...d, dataset: { ...d.dataset, ref: key === LATEST ? '' : String(key) } }))
            }
          />
        </div>
      ) : null}
      {custom ? (
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
              onPress={() =>
                setDoc((d) => ({ ...d, dataset: { mode: 'project', name: '', ref: '', custom: '' } }))
              }
            >
              Remove
            </Button>
          </div>
        </Callout>
      ) : null}
      {datasetNames != null && !items.length && !custom ? (
        <p className={styles.help}>Add a dataset in the project’s Datasets page to run an experiment.</p>
      ) : null}
    </div>
  );
}
