/**
 * The group-metrics strip: ONE full-width row under the passes of an open run (redesign 4, decision D1).
 * Title, Metric select, the pass-threshold chip, the five group statistics and one help marker.
 */
import { useState } from 'react';
import type { RunRow } from '@/api/dashboardTypes';
import { useGroupMetrics, useRunPasses } from '@/api/dashboard';
import { HelpMarker, Select, Text } from '@/ui';
import { useRunsCtx } from '../context';
import { groupChoiceFor } from './groupQuery';
import { PassStats, statDefinitions } from './PassStats';
import { PassThreshold } from './PassThreshold';
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
  // the metric and threshold a fresh strip opens with come from the row alone (the page prefetches the same request)
  const {
    scoreMetrics,
    metric: activeMetric,
    direction: dir,
    threshold: defaultThreshold,
  } = groupChoiceFor(row, remembered, metricTypes, passesQ.data?.metrics);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const activeThreshold = (activeMetric ? thresholds[activeMetric] : undefined) ?? defaultThreshold;
  // `view=group`: the five statistics this strip shows, none of the bootstrap curve the run page reads (round 7, Q2)
  const wantsGroup = Boolean(activeMetric) && row.samples > 1;
  const groupQ = useGroupMetrics(row.run_id, activeMetric, activeThreshold, {
    enabled: wantsGroup,
    view: 'group',
  });
  const g = groupQ.data?.group ?? null;
  // The frame is always the strip's own layout (round 7, Q2-9): while the passes or the statistics are on their way the
  // labels, the select and the threshold are real and the values are skeletons, so the group never changes height.
  const loading = g === null && !groupQ.isError && (passesQ.isPending || (wantsGroup && groupQ.isPending));
  const k = g?.k ?? row.samples;
  const items = g?.total_items ?? row.total_items;
  return (
    <div className={styles.strip} role="group" aria-label="Group metrics" aria-busy={loading || undefined}>
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
        <PassStats group={g} k={k} dir={dir} busy={groupQ.isFetching} loading={loading} />
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
