/** Per-run averages, legacy orientation: a row per metric (plus latency and errors), a column per run. Cards below 768px. */
import { useMemo, type ReactNode } from 'react';
import { formatLatency, formatMetricValue, metricDirectionLabel } from '@/lib/metrics';
import { useMediaQuery } from '@/features/shell';
import { Card, DataTable, ScoreValue, Tag, Text, type Column } from '@/ui';
import { runSeries, useCompare } from '../../CompareContext';
import type { DeltaKind, MetricColumn } from '../../lib/baseline';
import { columnName } from '../../lib/columnName';
import { buildColumnRows, type ColumnRow } from '../../lib/panelData';
import { CountButtons, DeltaTag, Forest } from '../common';
import { RunTag, useRunMark } from '../RunTag';
import styles from './AveragesMatrix.module.css';

interface MatrixRow {
  id: string;
  kind: 'metric' | 'latency' | 'errors';
  label: string;
  metric?: string;
}

function Mark({ index, children }: { index: number; children: ReactNode }) {
  const mark = useRunMark(index);
  return (
    <div className={styles.cell} {...mark}>
      {children}
    </div>
  );
}

export function AveragesMatrix() {
  const { model, columns, baseline, items, ctx, c } = useCompare();
  const narrow = useMediaQuery('(max-width: 767px)');
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

  const cellBody = (row: MatrixRow, r: ColumnRow) => {
    if (row.kind === 'latency')
      return (
        <>
          <span className={styles.value}>{r.latency === null ? '—' : formatLatency(r.latency)}</span>
          {r.isBaseline ? (
            <Text variant="sm" tone="muted">
              baseline
            </Text>
          ) : r.latencyRel !== null ? (
            <Tag
              kind="data"
              tone={r.latencyRel < -0.02 ? 'success' : r.latencyRel > 0.02 ? 'danger' : undefined}
            >
              {r.latencyRel < -0.02 ? '▼' : r.latencyRel > 0.02 ? '▲' : '≈'} {r.latencyRel >= 0 ? '+' : '−'}
              {Math.abs(r.latencyRel * 100).toFixed(0)}%
            </Tag>
          ) : null}
        </>
      );
    if (row.kind === 'errors')
      return (
        <span className={styles.value}>
          {r.taskErrors} task {'·'} {r.metricErrors} scorer
        </span>
      );
    const m = row.metric!;
    const cell = r.metrics[m]!;
    const type = model.types[m] ?? 'score';
    return (
      <>
        <ScoreValue
          variant="pill"
          value={cell.mean}
          type={type}
          direction={model.directions[m] ?? null}
          text={cell.mean === null ? '—' : formatMetricValue(cell.mean, type, 1)}
        />
        {r.isBaseline ? (
          <Text variant="sm" tone="muted">
            baseline
          </Text>
        ) : cell.delta ? (
          <>
            <span className={styles.deltaRow}>
              <DeltaTag stats={cell.delta} type={type} metric={m} />
              <Forest stats={cell.delta} />
            </span>
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
    />
  );

  if (narrow)
    return (
      <ul className={styles.cards} aria-label="Per-run averages">
        {[baseline, ...columns.filter((col) => col.key !== baseline.key)].map((col) => {
          const r = byCol.get(col.key);
          if (!r) return null;
          const idx = col.runIdxs[0] ?? 0;
          return (
            <li key={col.key} data-testid="average-card" data-column={col.key}>
              <Card series={runSeries(idx)} compact>
                <div className={styles.cardStack}>
                  {header(col)}
                  {rows.map((row) => (
                    <div key={row.id} className={styles.cardRow} data-metric={row.metric}>
                      <span className={styles.metricName}>{row.label}</span>
                      <div className={styles.cardCell}>{cellBody(row, r)}</div>
                    </div>
                  ))}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    );

  const tableColumns: Column<MatrixRow>[] = [
    {
      id: 'metric',
      header: 'Metric',
      pin: 'start',
      width: 128,
      resizable: false,
      cell: (row) => (
        <span
          className={styles.metricName}
          data-active={row.metric === ctx.metric || undefined}
          title={row.metric ? metricDirectionLabel(model.directions[row.metric] ?? null) : undefined}
        >
          {row.label}
        </span>
      ),
    },
    ...columns.map((col): Column<MatrixRow> => ({
      id: col.key,
      header: header(col),
      label: columnName(model, col),
      minWidth: 132,
      maxWidth: 260,
      flex: true,
      resizable: false,
      cell: (row) => {
        const r = byCol.get(col.key);
        return r ? (
          <Mark index={col.runIdxs[0] ?? 0}>
            <div data-testid="average-cell" data-column={col.key} data-row={row.id} className={styles.stack}>
              {cellBody(row, r)}
            </div>
          </Mark>
        ) : null;
      },
    })),
  ];
  return (
    <DataTable<MatrixRow>
      aria-label="Per-run averages"
      columns={tableColumns}
      rows={rows}
      rowKey={(row) => row.id}
      density="comfortable"
      densityLocked
      columnMenu={false}
      zebra={false}
      rowProps={(row) => ({ 'data-testid': 'average-row', 'data-row': row.id })}
    />
  );
}
