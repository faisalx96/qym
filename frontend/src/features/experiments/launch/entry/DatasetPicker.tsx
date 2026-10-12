import { useMemo } from 'react';
import { useDatasetVersions } from '@/api/launch';
import { Button, Select, Text } from '@/ui';
import { pointerToFieldName } from '../model';
import { useLaunch } from '../LaunchContext';
import { Callout } from '../components/Callout';
import styles from './entry.module.css';

const LATEST = '__latest';

/** Project dataset + version/alias, and the callout for a dataset string a starting point carried. */
export function DatasetPicker() {
  const { doc, setDoc, slug, datasetNames, readOnly, registerField } = useLaunch();
  const name = doc.dataset.mode === 'project' ? doc.dataset.name : '';
  const versions = useDatasetVersions(slug, name || undefined);
  const items = useMemo(() => (datasetNames ?? []).map((n) => ({ key: n, label: n })), [datasetNames]);
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
