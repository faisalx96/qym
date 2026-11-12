/** Read-only, different-data and alignment notices (brief 05 §3 "Page load / selection"). */
import { useMemo } from 'react';
import { InlineNotice, Stack } from '@/ui';
import { useCompare } from '../CompareContext';
import { datasetSetsDiffer, runDatasetCount } from '../lib/datasetSets';

export function Notices() {
  const { model, letter } = useCompare();
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
      return `${i === 0 ? 'Run' : 'run'} ${letter(model.runs.findIndex((r) => r.run === run))} evaluated ${n}${i === 0 ? ` dataset${n === 1 ? '' : 's'}` : ''}`;
    });
    const shared = model.itemIds.filter((id) => model.runs.every((r) => r.byItem.has(id))).length;
    return { sentences, shared };
  }, [model, letter]);
  // Nothing to say: render nothing, so the page's flex gap does not reserve an empty slot.
  const unpaired = model.unpaired;
  if (!readOnlyRuns.length && !data && !datasetsNote && !unpaired && model.alignment.status === 'aligned')
    return null;
  const differentTasks = !!unpaired && new Set(unpaired.map((u) => u.task)).size > 1;
  return (
    <Stack gap="sm">
      {unpaired ? (
        // C058: runs of different tasks (or datasets) are not paired item by item
        <InlineNotice
          tone="warning"
          lead={`${differentTasks ? 'Different tasks' : 'Different datasets'}: items are not paired.`}
          data-notice="unpaired"
          data-testid="compare-unpaired-notice"
        >
          {unpaired
            .map((u) => `${u.name}: ${[u.task, u.dataset].filter(Boolean).join(' on ') || 'no task'}`)
            .join('; ')}
          . The averages compare the runs as a whole.
        </InlineNotice>
      ) : null}
      {readOnlyRuns.length ? (
        <InlineNotice tone="warning" lead="Read-only." data-notice="read-only">
          {readOnlyRuns.length === 1
            ? `“${readOnlyRuns[0]}” belongs to an archived project, so its scores and diagnoses cannot be changed until an admin unarchives the project.`
            : `${readOnlyRuns.length} of these runs belong to archived projects, so their scores and diagnoses cannot be changed until those projects are unarchived.`}
        </InlineNotice>
      ) : null}
      {datasetsNote ? (
        <InlineNotice
          tone="info"
          icon="info"
          lead="The runs evaluated different datasets."
          data-testid="compare-datasets-notice"
          data-notice="different-datasets"
        >
          {datasetsNote.sentences.length === 2
            ? datasetsNote.sentences.join(' and ')
            : `${datasetsNote.sentences.slice(0, -1).join(', ')} and ${datasetsNote.sentences.at(-1)}`}
          . Items are matched by dataset and item id, so the{' '}
          {datasetsNote.sentences.length === 2 ? 'two ' : ''}
          runs share <b>{datasetsNote.shared}</b> {datasetsNote.shared === 1 ? 'item' : 'items'}; the metric
          averages below are still comparable as run means.
        </InlineNotice>
      ) : null}
      {data && !datasetsNote && !unpaired ? (
        <InlineNotice tone="warning" lead="Different data." data-notice="different-data">
          These runs used{' '}
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
        </InlineNotice>
      ) : null}
      {model.alignment.status !== 'aligned' ? (
        <InlineNotice tone="danger" lead="These runs cannot be aligned item by item." data-notice="alignment">
          {
            'They do not share reliable item identities, so item-level comparison is disabled; run-level averages below are still shown. '
          }
          {model.alignment.runs
            .map((r) => `${r.run_name}${r.issues.length ? ` (${r.issues.join('; ')})` : ''}`)
            .join('; ')}
        </InlineNotice>
      ) : null}
    </Stack>
  );
}
