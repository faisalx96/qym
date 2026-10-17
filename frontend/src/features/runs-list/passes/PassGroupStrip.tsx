/**
 * The group-metrics strip: ONE full-width row under the passes of an open run (redesign 4, decision D1).
 * Title, Metric select, the pass-threshold chip, the five group statistics and one help marker.
 */
import { useState } from 'react';
import type { RunRow } from '@/api/dashboardTypes';
import { useGroupMetrics, useRunPasses } from '@/api/dashboard';
import { HelpMarker, Select, Text } from '@/ui';
import { metricDirection } from '@/lib/metrics';
import { defaultMetricName, defaultPassThreshold, groupStatRule, toChartRun } from '../chartModel';
import { useRunsCtx } from '../context';
import { PassStats, statDefinitions } from './PassStats';
import { PassThreshold } from './PassThreshold';
import { resolveMetric } from './rows';
import styles from './PassGroupStrip.module.css';

export function PassGroupStrip({
  row,
  remembered,
  onMetric,
}: {
  row: RunRow;
  /** The metric last chosen in this project (shared by every open group and the card lines). */
  remembered: string | null;
  onMetric: (metric: string) => void;
}) {
  const { metricTypes } = useRunsCtx();
  const passesQ = useRunPasses(row.run_id);
  const scoreMetrics = (passesQ.data?.metrics ?? row.metrics).filter((m) => metricTypes[m] !== 'numeric');
  const activeMetric = resolveMetric(
    remembered,
    scoreMetrics,
    defaultMetricName(scoreMetrics, row.metric_specs) ?? null,
  );
  const rule = activeMetric ? groupStatRule([toChartRun(row)], activeMetric) : null;
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const dir = metricDirection(row.metric_specs[activeMetric ?? '']);
  const defaultThreshold =
    rule?.threshold ?? defaultPassThreshold(activeMetric ? row.metric_specs[activeMetric] : undefined, dir);
  const activeThreshold = (activeMetric ? thresholds[activeMetric] : undefined) ?? defaultThreshold;
  const groupQ = useGroupMetrics(row.run_id, activeMetric, activeThreshold, {
    enabled: Boolean(activeMetric) && row.samples > 1,
  });
  const g = groupQ.data?.group ?? null;
  if (passesQ.isPending)
    return (
      <div className={styles.strip} role="group" aria-label="Group metrics" aria-busy="true">
        <Text variant="sm" tone="muted" as="span">
          Loading group metrics…
        </Text>
      </div>
    );
  const k = g?.k ?? row.samples;
  const items = g?.total_items ?? row.total_items;
  return (
    <div className={styles.strip} role="group" aria-label="Group metrics">
      <span className={styles.title}>
        <Text variant="md" as="span">
          Passes
        </Text>
        <Text variant="sm" tone="muted" as="span">
          {k} · {items} items
        </Text>
      </span>
      <span className={styles.select}>
      <Select
        label="Metric"
        hideLabel
        items={scoreMetrics.map((m) => ({ key: m, label: m.replace(/_/g, ' ') }))}
        value={activeMetric}
        onChange={(key) => {
          if (key) onMetric(String(key));
        }}
        width="100%"
      />
      </span>
      {dir && activeMetric ? (
        <PassThreshold
          value={activeThreshold}
          defaultValue={defaultThreshold}
          direction={dir}
          onChange={(v) => setThresholds((t) => ({ ...t, [activeMetric]: v }))}
          onReset={() =>
            setThresholds((t) => {
              const next = { ...t };
              delete next[activeMetric];
              return next;
            })
          }
        />
      ) : (
        <Text variant="sm" tone="muted" as="span">
          No direction declared
        </Text>
      )}
      {groupQ.isError ? (
        <Text variant="sm" tone="muted" as="span" className={styles.error}>
          Group metrics are not available:{' '}
          {groupQ.error instanceof Error ? groupQ.error.message : 'request failed'}
        </Text>
      ) : (
        <PassStats group={g} k={k} dir={dir} busy={groupQ.isFetching} />
      )}
      <HelpMarker label="group metrics">
        <dl className={styles.defs}>
          {statDefinitions(k).map((d) => (
            <div key={d.label}>
              <dt>{d.label}</dt>
              <dd>{d.help}</dd>
            </div>
          ))}
        </dl>
      </HelpMarker>
    </div>
  );
}
