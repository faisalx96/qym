import { useId } from 'react';
import { viewRunTo } from './JobStatus';
import type { RunPasses, RunSummary } from '@/api/analysis';
import { useModelIndex } from '@/api/dashboard';
import { modelSeriesOf } from '@/features/runs-list/model';
import { DatasetTag, KeyValueGrid, LinkButton, ModelTag, Select, TaskTag, Text, ToggleChips } from '@/ui';
import s from './blocks.module.css';

/**
 * The run's facts as label-above-value fields (as the run page hero) and the metric choice (cv5 K1: `ToggleChips`,
 * every metric visible, at least one on). The run name is the page header's meta line, so it is not repeated here.
 */
export function RunFacts({
  slug,
  runId,
  run,
  metrics,
  selected,
  onMetrics,
}: {
  slug: string;
  runId: string;
  run: RunSummary['run'];
  metrics: string[];
  selected: string[];
  onMetrics: (next: string[]) => void;
}) {
  const modelIndex = useModelIndex(slug);
  const metricsLabelId = useId();
  return (
    <div className={s.facts}>
      <KeyValueGrid
        columns={4}
        aria-label="Run"
        items={[
          { key: 'task', label: 'Task', value: <TaskTag name={run.task_name} /> },
          {
            key: 'model',
            label: 'Model',
            value: run.model_name ? (
              <ModelTag name={run.model_name} series={modelSeriesOf(modelIndex, run.model_name, false)} />
            ) : (
              '—'
            ),
          },
          { key: 'dataset', label: 'Dataset', value: <DatasetTag name={run.dataset_name} /> },
          { key: 'run', label: 'Run ID', value: runId, mono: true },
        ]}
      />
      {/* cv5 K1: every metric is a visible on/off chip (owner: "people might not know that these are all selected"). */}
      <div className={s.metricField}>
        <Text variant="sm" weight={600} tone="muted" as="span" id={metricsLabelId}>
          Metrics
        </Text>
        <ToggleChips
          aria-labelledby={metricsLabelId}
          options={metrics.map((m) => ({ value: m, label: m }))}
          value={selected}
          onChange={(next) => onMetrics(metrics.filter((m) => next.includes(m)))}
          min={1}
        />
        <Text variant="sm" tone={selected.length ? 'muted' : 'warning'} as="span" role="status">
          {selected.length
            ? 'Targets are the failed items of these metrics.'
            : 'Select at least one metric to analyze.'}
        </Text>
      </div>
    </div>
  );
}

/** Pass select (repeat runs) and View run: the end side of the run head. */
export function RunActions({
  slug,
  runId,
  passes,
  pass,
  onPass,
  busy,
}: {
  slug: string;
  runId: string;
  passes: RunPasses['passes'];
  pass: number | null;
  onPass: (pass: number) => void;
  busy: boolean;
}) {
  return (
    <>
      {passes.length > 1 && pass != null ? (
        <Select
          label="Pass"
          triggerVariant="bar"
          items={passes.map((p) => ({
            key: String(p.pass_number),
            label: `Pass ${p.pass_number} (${p.items_scored}/${p.items_total})`,
          }))}
          value={String(pass)}
          onChange={(k) => k != null && onPass(Number(k))}
          isDisabled={busy}
          help={busy ? 'Wait for the running job, or cancel it, to switch passes.' : undefined}
          searchable={false}
        />
      ) : null}
      <LinkButton size="sm" to={viewRunTo(slug, runId, pass)}>
        View run
      </LinkButton>
    </>
  );
}
