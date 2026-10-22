/** Read-only, different-data and alignment notices (brief 05 §3 "Page load / selection"). */
import { useMemo } from 'react';
import { Icon, Stack, Text } from '@/ui';
import { letterOf, useCompare } from '../CompareContext';
import { datasetSetsDiffer, runDatasetCount } from '../lib/datasetSets';
import styles from './Notices.module.css';

export function Notices() {
  const { model } = useCompare();
  const readOnlyRuns = useMemo(
    () =>
      Array.from(
        new Set(
          model.runs
            .filter((r) => r.run.project?.archived)
            .map((r) => r.run.base_run_name || r.run.run_name || r.base),
        ),
      ),
    [model],
  );
  const data = useMemo(() => {
    const groups = new Map<string, { dataset: string; version: string; runs: string[] }>();
    const seen = new Set<string>();
    for (const r of model.runs) {
      if (seen.has(r.base)) continue;
      seen.add(r.base);
      const dataset = String(r.run.dataset_name || '').trim();
      const version = String(r.run.dataset_version ?? '').trim();
      const key = `${dataset}␟${version}`;
      const g = groups.get(key) ?? { dataset, version, runs: [] };
      g.runs.push(r.label.replace(/ · pass \d+$/, ''));
      groups.set(key, g);
    }
    const entries = Array.from(groups.values());
    const datasets = new Set(entries.map((e) => e.dataset));
    const versioned = entries.filter((e) => e.version);
    const mismatch =
      datasets.size > 1 || (versioned.length > 1 && new Set(versioned.map((e) => e.version)).size > 1);
    return mismatch ? { entries, multipleDatasets: datasets.size > 1 } : null;
  }, [model]);
  // Runs over different sets of dataset versions (a union run among them): one status note replaces the generic one.
  const datasetsNote = useMemo(() => {
    const runs = model.bases.map((base) => model.runs.find((r) => r.base === base)?.run).filter((r) => !!r);
    if (!datasetSetsDiffer(runs)) return null;
    const sentences = runs.map((run, i) => {
      const n = runDatasetCount(run);
      return `${i === 0 ? 'Run' : 'run'} ${letterOf(i)} evaluated ${n}${i === 0 ? ` dataset${n === 1 ? '' : 's'}` : ''}`;
    });
    const shared = model.itemIds.filter((id) => model.runs.every((r) => r.byItem.has(id))).length;
    return { sentences, shared };
  }, [model]);
  // Nothing to say: render nothing, so the page's flex gap does not reserve an empty slot.
  if (!readOnlyRuns.length && !data && !datasetsNote && model.alignment.status === 'aligned') return null;
  return (
    <Stack gap="sm">
      {readOnlyRuns.length ? (
        <div className={styles.note} role="note" data-notice="read-only">
          <strong>Read-only.</strong>{' '}
          {readOnlyRuns.length === 1
            ? `“${readOnlyRuns[0]}” belongs to an archived project, so its scores and diagnoses cannot be changed until an admin unarchives the project.`
            : `${readOnlyRuns.length} of these runs belong to archived projects, so their scores and diagnoses cannot be changed until those projects are unarchived.`}
        </div>
      ) : null}
      {datasetsNote ? (
        <div
          className={styles.info}
          role="status"
          data-testid="compare-datasets-notice"
          data-notice="different-datasets"
        >
          <Icon name="info" size={16} />
          <div>
            <div className={styles.infoTitle}>The runs evaluated different datasets</div>
            <p className={styles.infoBody}>
              {datasetsNote.sentences.length === 2
                ? datasetsNote.sentences.join(' and ')
                : `${datasetsNote.sentences.slice(0, -1).join(', ')} and ${datasetsNote.sentences.at(-1)}`}
              . Items are matched by dataset and item id, so the{' '}
              {datasetsNote.sentences.length === 2 ? 'two ' : ''}
              runs share <b>{datasetsNote.shared}</b> {datasetsNote.shared === 1 ? 'item' : 'items'}; the
              metric averages below are still comparable as run means.
            </p>
          </div>
        </div>
      ) : null}
      {data && !datasetsNote ? (
        <div className={styles.note} role="note" data-notice="different-data">
          <strong>Different data.</strong> These runs used{' '}
          {data.multipleDatasets ? 'different datasets' : `different versions of ${data.entries[0]?.dataset}`}
          :{' '}
          {data.entries
            .map(
              (e) =>
                `${data.multipleDatasets ? `${e.dataset}${e.version ? ` ${e.version}` : ''}` : e.version || 'no version'} (${e.runs.join(', ')})`,
            )
            .join('; ')}
          . Score changes can come from the data as well as from the runs, and only items present in both runs
          are paired.
        </div>
      ) : null}
      {model.alignment.status !== 'aligned' ? (
        <div className={styles.alert} role="alert" data-notice="alignment">
          <Text variant="md" weight={600}>
            These runs cannot be aligned item by item
          </Text>
          <Text variant="base" tone="muted">
            They do not share reliable item identities, so item-level comparison is disabled; run-level
            averages below are still shown.
          </Text>
          <ul>
            {model.alignment.runs.map((r) => (
              <li key={r.run_name}>
                <strong>{r.run_name}</strong>
                {r.issues.length ? ` (${r.issues.join('; ')})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Stack>
  );
}
