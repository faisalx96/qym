/** Runs x metrics with baseline stats over the filtered items (brief 05 J3), as a real table. */
import { useMemo } from 'react';
import { formatLatency, formatMetricValue } from '@/lib/metrics';
import { Tag, Text } from '@/ui';
import { letterOf, useCompare } from '../../CompareContext';
import { buildColumnRows, buildTraceRows, type TraceFormat } from '../../lib/panelData';
import type { DeltaKind } from '../../lib/baseline';
import { CountButtons, DeltaTag, Forest, RunDot } from '../common';
import { ScrollRegion } from '../ScrollRegion';
import styles from './Panel.module.css';

const fmtTrace = (v: number, f: TraceFormat) =>
  f === 'latency'
    ? formatLatency(v)
    : f === 'tokens'
      ? Math.round(v).toLocaleString()
      : f === 'percent'
        ? `${(v * 100).toFixed(1)}%`
        : v.toFixed(1);

function TraceStatsTable() {
  const { model, columns } = useCompare();
  const rows = useMemo(() => buildTraceRows(model, columns), [model, columns]);
  if (!rows.length) return null;
  return (
    <table className={styles.table} data-testid="trace-stats-table">
      <caption className={styles.caption}>
        Trace statistics per run (a repeat run&apos;s passes share them). A dash means the run did not capture
        it.
      </caption>
      <thead>
        <tr>
          <th scope="col">Trace stat</th>
          {columns.map((col) => (
            <th scope="col" key={col.key} title={col.title}>
              <span className={styles.runCell}>
                <RunDot index={col.runIdxs[0] ?? 0} />
                <span className={styles.letter}>{letterOf(col.runIdxs[0] ?? 0)}</span>
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const valid = r.values.filter((v): v is number => v !== null);
          const bestVal = valid.length ? (r.best === 'high' ? Math.max(...valid) : Math.min(...valid)) : null;
          return (
            <tr key={r.id} data-trace-row={r.id}>
              <th scope="row">{r.label}</th>
              {r.values.map((v, i) => (
                <td key={columns[i]!.key}>
                  <span
                    className={styles.mono}
                    title={v !== null && v === bestVal && valid.length > 1 ? 'Best across runs' : undefined}
                  >
                    {v === null ? '—' : fmtTrace(v, r.format)}
                    {v !== null && v === bestVal && valid.length > 1 ? ' ★' : ''}
                  </span>
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function MetricsTab() {
  const { model, columns, baseline, items, ctx, c } = useCompare();
  const ids = useMemo(() => new Set(items.map((i) => i.itemId)), [items]);
  const rows = useMemo(
    () => buildColumnRows(model, columns, baseline, ids, c.view.thresholds),
    [model, columns, baseline, ids, c.view.thresholds],
  );
  const active = c.view.filters.baseline;
  const toggle = (colKey: string, metric: string, kind: DeltaKind) => {
    const same = active && active.columnKey === colKey && active.kind === kind && active.metric === metric;
    c.setView({
      metric,
      filters: {
        ...c.view.filters,
        baseline: same ? null : { metric, columnKey: colKey, baselineKey: baseline.key, kind },
      },
    });
  };
  return (
    <ScrollRegion className={styles.scroll} label="Metrics table">
      <table className={styles.table}>
        <caption className={styles.caption}>
          Average per run over {ids.size} filtered item{ids.size === 1 ? '' : 's'}; change is the paired
          difference from the baseline with its 95% noise band.
        </caption>
        <thead>
          <tr>
            <th scope="col">Run</th>
            {model.metrics.map((m) => (
              <th scope="col" key={m} data-active={m === ctx.metric || undefined}>
                {m}
              </th>
            ))}
            <th scope="col">Latency</th>
            <th scope="col">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const idx = r.column.runIdxs[0] ?? 0;
            return (
              <tr key={r.column.key} data-baseline={r.isBaseline || undefined}>
                <th scope="row">
                  <span className={styles.runCell} title={r.column.title}>
                    <RunDot index={idx} />
                    <span className={styles.letter}>{letterOf(idx)}</span>
                    <span className={styles.runLabel}>{r.column.label}</span>
                    {r.isBaseline ? <Tag kind="accent">Base</Tag> : null}
                  </span>
                </th>
                {model.metrics.map((m) => {
                  const cell = r.metrics[m]!;
                  const type = model.types[m] ?? 'score';
                  return (
                    <td key={m}>
                      <div className={styles.cell}>
                        <span className={styles.value}>
                          {cell.mean === null ? '—' : formatMetricValue(cell.mean, type, 1)}
                        </span>
                        {r.isBaseline ? (
                          <Text variant="sm" tone="muted">
                            baseline
                          </Text>
                        ) : cell.delta ? (
                          <>
                            <DeltaTag stats={cell.delta} type={type} metric={m} />
                            <Forest stats={cell.delta} />
                            <CountButtons
                              stats={cell.delta}
                              direction={model.directions[m] ?? null}
                              label={m}
                              active={
                                active && active.columnKey === r.column.key && active.metric === m
                                  ? (active.kind as DeltaKind)
                                  : null
                              }
                              onToggle={(k) => toggle(r.column.key, m, k)}
                            />
                          </>
                        ) : null}
                      </div>
                    </td>
                  );
                })}
                <td>
                  <span className={styles.mono}>{r.latency === null ? '—' : formatLatency(r.latency)}</span>
                  {r.latencyRel !== null ? (
                    <Tag
                      kind="data"
                      tone={r.latencyRel < -0.02 ? 'success' : r.latencyRel > 0.02 ? 'danger' : undefined}
                    >
                      {r.latencyRel < -0.02 ? '▼' : r.latencyRel > 0.02 ? '▲' : '≈'}{' '}
                      {r.latencyRel >= 0 ? '+' : '−'}
                      {Math.abs(r.latencyRel * 100).toFixed(0)}%
                    </Tag>
                  ) : null}
                </td>
                <td>
                  <span className={styles.mono}>
                    {r.taskErrors} task {'·'} {r.metricErrors} scorer
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <TraceStatsTable />
    </ScrollRegion>
  );
}
