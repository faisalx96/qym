/** Step latency per column (mean ms per traced step) with change against the baseline. */
import { useMemo } from 'react';
import { useCompareStepLatency } from '@/api/compare';
import { formatLatency } from '@/lib/metrics';
import { ErrorState, Skeleton, Tag, Text } from '@/ui';
import { letterOf, useCompare } from '../../CompareContext';
import { RunDot } from '../common';
import { ScrollRegion } from '../ScrollRegion';
import styles from './Panel.module.css';

export function StepsTab() {
  const { model, columns, baseline } = useCompare();
  const traced = model.runs.some((r) => r.run.trace_stats?.has_spans);
  const refs = useMemo(() => columns.map((c) => c.key), [columns]);
  const q = useCompareStepLatency(refs, traced);
  const rows = useMemo(() => {
    const by = q.data?.groups_by_ref ?? {};
    const names = new Map<string, { phase: string; name: string }>();
    columns.forEach((c) => (by[c.key] ?? []).forEach((g) => names.set(`${g.phase}|${g.name ?? g.step_type ?? ''}`, { phase: g.phase, name: g.name ?? g.step_type ?? '' })));
    return Array.from(names.entries()).map(([key, info]) => ({
      key,
      ...info,
      cells: columns.map((c) => (by[c.key] ?? []).find((g) => `${g.phase}|${g.name ?? g.step_type ?? ''}` === key)),
    }));
  }, [q.data, columns]);
  if (!traced) return <Text variant="sm" tone="muted">None of the compared runs recorded traces.</Text>;
  if (q.isPending) return <Skeleton kind="table" rows={4} />;
  if (q.error) return <ErrorState compact error={q.error} title="Couldn’t load step latency" onRetry={() => void q.refetch()} />;
  if (!rows.length) return <Text variant="sm" tone="muted">No traced steps for these runs.</Text>;
  const bi = columns.indexOf(baseline);
  return (
    <ScrollRegion className={styles.scroll} label="Step latency">
      <table className={styles.table}>
        <caption className={styles.caption}>Mean latency per traced step; change is against the baseline.</caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            {columns.map((c) => (
              <th scope="col" key={c.key} title={c.title}>
                <RunDot index={c.runIdxs[0] ?? 0} /> {letterOf(c.runIdxs[0] ?? 0)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const b = r.cells[bi]?.mean_ms ?? null;
            return (
              <tr key={r.key}>
                <th scope="row">
                  <span className={styles.runLabel} title={`${r.phase}: ${r.name}`}>
                    {r.name || r.phase} <Tag kind="data">{r.phase}</Tag>
                  </span>
                </th>
                {r.cells.map((cell, i) => {
                  const v = cell?.mean_ms ?? null;
                  const rel = i !== bi && v !== null && b ? (v - b) / b : null;
                  return (
                    <td key={columns[i]!.key}>
                      <div className={styles.cell}>
                        <span className={styles.value}>{v === null ? '—' : formatLatency(v)}</span>
                        {rel !== null ? (
                          <Tag kind="data" tone={rel < -0.02 ? 'success' : rel > 0.02 ? 'danger' : undefined}>
                            {rel < -0.02 ? '▼' : rel > 0.02 ? '▲' : '≈'} {rel >= 0 ? '+' : '−'}
                            {Math.abs(rel * 100).toFixed(0)}%
                          </Tag>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
