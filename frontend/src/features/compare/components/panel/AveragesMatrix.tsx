/** Per-run averages, legacy orientation: a row per metric (plus latency and errors), a column per run. Cards below 768px. */
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { formatLatency, formatMetricValue, metricBand, metricDirectionLabel } from '@/lib/metrics';
import { useMediaQuery } from '@/features/shell';
import { Icon } from '@/ui';
import { useCompare } from '../../CompareContext';
import type { DeltaKind, MetricColumn } from '../../lib/baseline';
import { columnName } from '../../lib/columnName';
import { buildColumnRows, type ColumnRow } from '../../lib/panelData';
import { CountButtons, DeltaLine2 } from '../common';
import { RunTag, useRunMark } from '../RunTag';
import styles from './AveragesMatrix.module.css';

interface MatrixRow {
  id: string;
  kind: 'metric' | 'latency' | 'errors';
  label: string;
  metric?: string;
}

function Mark({ index, children, block }: { index: number; children: ReactNode; block?: boolean }) {
  const mark = useRunMark(index);
  return (
    <div className={block ? styles.markBlock : styles.mark} {...mark}>
      {children}
    </div>
  );
}

export function AveragesMatrix() {
  const { model, columns, baseline, items, ctx, c } = useCompare();
  const narrow = useMediaQuery('(max-width: 640px)');
  const ids = useMemo(() => new Set(items.map((i) => i.itemId)), [items]);
  const data = useMemo(
    () => buildColumnRows(model, columns, baseline, ids, c.view.thresholds),
    [model, columns, baseline, ids, c.view.thresholds],
  );
  const byCol = useMemo(() => new Map(data.map((r) => [r.column.key, r])), [data]);
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
  const rows: MatrixRow[] = [
    ...model.metrics.map((m): MatrixRow => ({ id: `m:${m}`, kind: 'metric', label: m, metric: m })),
    { id: 'latency', kind: 'latency', label: 'Latency' },
    { id: 'errors', kind: 'errors', label: 'Errors' },
  ];

  const verdictOf = (v: string | null | undefined) =>
    v === 'improved' ? 'up' : v === 'regressed' ? 'down' : undefined;

  const cellBody = (row: MatrixRow, r: ColumnRow) => {
    if (row.kind === 'latency')
      return (
        <>
          <span className={styles.plainValue}>{r.latency === null ? '—' : formatLatency(r.latency)}</span>
          {!r.isBaseline && r.latencyRel !== null ? (
            <span className={styles.latDelta} data-part="averages-delta">
              {r.latencyRel < -0.02 ? '▼' : r.latencyRel > 0.02 ? '▲' : '≈'} {r.latencyRel >= 0 ? '+' : '−'}
              {Math.abs(r.latencyRel * 100).toFixed(0)}%
            </span>
          ) : null}
        </>
      );
    if (row.kind === 'errors') {
      const total = r.taskErrors + r.metricErrors;
      return (
        <span className={styles.plainValue} data-bad={total ? '' : undefined}>
          {total ? `${r.taskErrors} task · ${r.metricErrors} scorer` : 'none'}
        </span>
      );
    }
    const m = row.metric!;
    const cell = r.metrics[m]!;
    const type = model.types[m] ?? 'score';
    const dir = model.directions[m] ?? null;
    const band = metricBand(cell.mean, type, dir);
    const beyond = !r.isBaseline && cell.delta ? verdictOf(cell.delta.verdict) : undefined;
    return (
      <>
        <span
          className={styles.valueBox}
          data-band={band ?? undefined}
          data-verdict={beyond}
          data-part="averages-value"
        >
          {cell.mean === null ? '—' : formatMetricValue(cell.mean, type, 1)}
        </span>
        {!r.isBaseline && cell.delta ? (
          <>
            <DeltaLine2 stats={cell.delta} type={type} metric={m} />
            <CountButtons
              stats={cell.delta}
              direction={dir}
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
      </>
    );
  };

  const header = (col: MetricColumn) => (
    <RunTag
      index={col.runIdxs[0] ?? 0}
      name={columnName(model, col)}
      title={col.title}
      baseline={col.key === baseline.key}
      compact
      bare
    />
  );
  const rowLabel = (row: MatrixRow) =>
    row.kind === 'latency' ? (
      <>
        <Icon name="clock" size={12} /> Avg latency
      </>
    ) : (
      row.label
    );
  const kindOf = (row: MatrixRow) => (row.kind === 'metric' ? 'full' : 'compact');

  if (narrow)
    return (
      <div className={styles.blocks} data-part="averages-table" aria-label="Per-run averages" role="group">
        {rows.map((row) => (
          <section key={row.id} className={styles.block} aria-label={row.label} data-row={row.id}>
            <h3 className={styles.blockHead} data-active={row.metric === ctx.metric || undefined}>
              {rowLabel(row)}
            </h3>
            {[baseline, ...columns.filter((col) => col.key !== baseline.key)].map((col) => {
              const r = byCol.get(col.key);
              if (!r) return null;
              return (
                <Mark key={col.key} index={col.runIdxs[0] ?? 0} block>
                  <div
                    className={styles.blockRow}
                    data-part="averages-cell"
                    data-testid="average-cell"
                    data-column={col.key}
                    data-row={row.id}
                    data-kind={row.kind}
                  >
                    {header(col)}
                    <div className={styles.blockValues}>{cellBody(row, r)}</div>
                  </div>
                </Mark>
              );
            })}
          </section>
        ))}
      </div>
    );

  return (
    <div className={styles.scroll} data-part="averages-table">
      <table
        className={styles.table}
        aria-label="Per-run averages"
        style={{ '--cols': columns.length } as CSSProperties}
      >
        <thead>
          <tr>
            <th scope="col" className={styles.metricHead}>
              Metric
            </th>
            {columns.map((col) => (
              <th
                scope="col"
                key={col.key}
                className={styles.runHead}
                data-part="averages-colhead"
                title={col.title}
              >
                {header(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-testid="average-row" data-row={row.id} data-part={`averages-${row.kind}-row`}>
              <th
                scope="row"
                className={styles.metricName}
                data-active={row.metric === ctx.metric || undefined}
                title={row.metric ? metricDirectionLabel(model.directions[row.metric] ?? null) : undefined}
              >
                {rowLabel(row)}
              </th>
              {columns.map((col) => {
                const r = byCol.get(col.key);
                return (
                  <td
                    key={col.key}
                    className={styles.cell}
                    data-size={kindOf(row)}
                    data-part="averages-cell"
                    data-testid="average-cell"
                    data-column={col.key}
                    data-row={row.id}
                    data-kind={row.kind}
                  >
                    {r ? <Mark index={col.runIdxs[0] ?? 0}>{cellBody(row, r)}</Mark> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
