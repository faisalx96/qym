/**
 * The metrics of an expanded item (round 3 P5): one matrix, metric rows by pass columns (or Score and Reason for one
 * pass), a Mean column, 8 rows then "Show N more metrics". A value opens ONE detail panel under the matrix (reason, judge
 * metadata, edit). The matrix is a DataTable grid; cells are buttons with a roving tabindex (arrows, Home / End,
 * Enter / Space open, Escape closes).
 */
import { useMemo, useRef, useState } from 'react';
import { formatNumericValue, formatPercent, metricBand } from '@/lib/metrics';
import { Button, DataTable, IconButton, Tag, type Column } from '@/ui';
import { useColumnStep } from '../../lib/columnStep';
import {
  DEFAULT_METRIC_ROWS,
  differsAcrossPasses,
  limitRows,
  matrixSummary,
  meanOf,
  orderMetrics,
} from '../../lib/metricMatrix';
import { metricPassesFor } from '../../lib/filterRules';
import { metricCell, type MetricCell } from '../../lib/rowDisplay';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { EditedBadge, editTooltip, hasMetaDetail, MetaList, useCanEdit } from './MetricStrip';
import { useItemsUi } from './ItemsUi';
import { ScoreEditor } from './ScoreEditor';
import styles from './MetricMatrix.module.css';

export interface MatrixPass {
  pass: number;
  /** The row scoped to this pass (the row itself for one pass). */
  scoped: Row;
}

interface MatrixRow {
  metric: string;
  cells: MetricCell[];
  mean: number | null;
  differs: boolean;
}

interface Pick {
  metric: string;
  pass: number;
}

const bandOf = (c: MetricCell) =>
  c.error || c.value === null || !c.direction ? null : metricBand(c.value, c.type, c.direction);

function cellText(c: MetricCell): string {
  return c.error ? 'Error' : c.text;
}

export function MetricMatrix({
  row,
  passes,
  multi,
  shown,
}: {
  row: Row;
  /** Every pass of the item (one entry for a single pass). */
  passes: MatrixPass[];
  multi: boolean;
  /** The passes shown in the pass columns on a narrow detail (hidden ones are re-selected from the rail). */
  shown: number[];
}) {
  const { model, api, runId, payload } = useRunPage();
  const ui = useItemsUi();
  const canEdit = useCanEdit(row);
  const [rootRef, , width] = useColumnStep<HTMLDivElement>(1000);
  const compact = width < 640;
  const [expandedRows, setExpandedRows] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const metrics = useMemo(
    () => orderMetrics(model.metricNames, api.selectedMetric),
    [model.metricNames, api.selectedMetric],
  );
  const rows = useMemo<MatrixRow[]>(
    () =>
      metrics.map((metric) => {
        const cells = passes.map((p) => metricCell(api.ctx, p.scoped, metric));
        const values = cells.map((c) => (c.error ? null : c.value));
        return { metric, cells, mean: meanOf(values), differs: differsAcrossPasses(values) };
      }),
    [metrics, passes, api.ctx],
  );
  const visible = limitRows(rows, expandedRows);
  const differing = rows.filter((r) => r.differs).length;
  const belowThreshold = rows.filter(
    (r) => r.cells[0] && !r.cells[0].error && metricPassesFor(api.ctx, r.metric, r.cells[0].value) === false,
  ).length;
  const passIdx = (pass: number) => passes.findIndex((p) => p.pass === pass);
  const passColumns = multi ? passes.filter((p) => !compact || shown.includes(p.pass)) : passes;
  const cellId = (metric: string, pass: number) => `${metric}::${pass}`;
  const first = visible[0] ? cellId(visible[0].metric, passColumns[0]?.pass ?? passes[0]!.pass) : null;
  const tabStop = active ?? first;

  const openCell = (metric: string, pass: number) => {
    setEditing(false);
    setPick((cur) => (cur && cur.metric === metric && cur.pass === pass ? null : { metric, pass }));
  };
  const focusCell = (metric: string, pass: number) => {
    setActive(cellId(metric, pass));
    Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-cell]') ?? [])
      .find((el) => el.dataset.cell === cellId(metric, pass))
      ?.focus();
  };
  const onCellKey = (e: React.KeyboardEvent, metric: string, pass: number) => {
    const r = visible.findIndex((x) => x.metric === metric);
    const c = passColumns.findIndex((p) => p.pass === pass);
    let nr = r;
    let nc = c;
    if (e.key === 'ArrowRight') nc = Math.min(passColumns.length - 1, c + 1);
    else if (e.key === 'ArrowLeft') nc = Math.max(0, c - 1);
    else if (e.key === 'ArrowDown') nr = Math.min(visible.length - 1, r + 1);
    else if (e.key === 'ArrowUp') nr = Math.max(0, r - 1);
    else if (e.key === 'Home') nc = 0;
    else if (e.key === 'End') nc = passColumns.length - 1;
    else if (e.key === 'Escape' && pick) {
      e.preventDefault();
      e.stopPropagation();
      setPick(null);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
    focusCell(visible[nr]!.metric, passColumns[nc]!.pass);
  };

  const renderCell = (r: MatrixRow, pass: number) => {
    const cell = r.cells[passIdx(pass)]!;
    const band = bandOf(cell);
    const id = cellId(r.metric, pass);
    const selected = pick?.metric === r.metric && pick.pass === pass;
    return (
      <button
        type="button"
        className={styles.cell}
        data-cell={id}
        data-band={band ?? undefined}
        data-error={cell.error ? '' : undefined}
        data-edited={cell.edited ? '' : undefined}
        data-selected={selected ? '' : undefined}
        tabIndex={tabStop === id ? 0 : -1}
        aria-label={`${r.metric}, pass ${pass}: ${cellText(cell)}${cell.edited ? ' (edited)' : ''}`}
        aria-pressed={selected}
        onFocus={() => setActive(id)}
        onClick={() => openCell(r.metric, pass)}
        onKeyDown={(e) => onCellKey(e, r.metric, pass)}
      >
        {cellText(cell)}
      </button>
    );
  };

  const meanText = (r: MatrixRow) =>
    r.mean === null
      ? '—'
      : model.metricTypes[r.metric] === 'numeric'
        ? formatNumericValue(r.mean)
        : formatPercent(r.mean, 0);
  const columns: Column<MatrixRow>[] = [
    {
      id: 'metric',
      header: 'Metric',
      label: 'Metric',
      pin: 'start',
      lockOrder: true,
      width: compact ? 62 : 200,
      minWidth: compact ? 56 : 96,
      cell: (r) => (
        <span
          className={styles.metricName}
          title={
            model.metricDirections[r.metric] === 'minimize'
              ? 'Lower is better'
              : model.metricDirections[r.metric] === 'maximize'
                ? 'Higher is better'
                : undefined
          }
        >
          {r.metric}
        </span>
      ),
    },
    ...(multi
      ? passColumns.map((p): Column<MatrixRow> => ({
          id: `pass-${p.pass}`,
          header: String(p.pass),
          label: String(p.pass),
          align: 'end',
          width: compact ? 38 : 64,
          minWidth: compact ? 32 : 48,
          cell: (r) => renderCell(r, p.pass),
        }))
      : [
          {
            id: 'score',
            header: 'Score',
            label: 'Score',
            align: 'start' as const,
            width: 110,
            cell: (r: MatrixRow) => renderCell(r, passes[0]!.pass),
          },
        ]),
    ...(multi
      ? [
          {
            id: 'mean',
            header: 'Mean',
            label: 'Mean',
            align: 'end' as const,
            width: compact ? 51 : 72,
            minWidth: compact ? 40 : 56,
            cell: (r: MatrixRow) => <span className={styles.mean}>{meanText(r)}</span>,
          } satisfies Column<MatrixRow>,
        ]
      : [
          {
            id: 'reason',
            header: 'Reason',
            label: 'Reason',
            flex: true,
            minWidth: 160,
            cell: (r: MatrixRow) => {
              const meta = (passes[0]!.scoped.metric_meta?.[r.metric] ?? {}) as Record<string, unknown>;
              const text = String(meta.reason ?? meta.explanation ?? meta.label ?? '');
              return (
                <span className={styles.reason} dir="auto" title={text || undefined}>
                  {text || '—'}
                </span>
              );
            },
          } satisfies Column<MatrixRow>,
        ]),
  ];

  const pickRow = pick ? rows.find((r) => r.metric === pick.metric) : null;
  const pickPass = pick ? passes[passIdx(pick.pass)] : null;
  const pickCell = pickRow && pick ? pickRow.cells[passIdx(pick.pass)] : null;
  const meta = (pickPass?.scoped.metric_meta?.[pick?.metric ?? ''] ?? {}) as Record<string, unknown>;
  const suffix = multi && pick ? ` for pass ${pick.pass}` : '';
  const editable = canEdit && !!pick;
  return (
    <div ref={rootRef} className={styles.matrix}>
      <div className={styles.head}>
        <h3 className={styles.title}>Metrics</h3>
        <span className={styles.summary} data-testid="matrix-summary">
          {matrixSummary({
            shown: visible.length,
            total: rows.length,
            passes: multi ? passes.length : 1,
            belowThreshold,
            differing,
          })}
        </span>
      </div>
      <div ref={gridRef} className={styles.gridHost} data-compact={compact ? '' : undefined}>
        <DataTable<MatrixRow>
          // the column widths are seeded once: a new layout (compact or not) is a new table
          key={compact ? 'compact' : 'wide'}
          aria-label="Metrics by pass"
          columns={columns}
          rows={visible}
          rowKey={(r) => r.metric}
          density="compact"
          densityLocked
          columnMenu={false}
          zebra={false}
          variant="embedded"
          stickyHeader={false}
          responsive="scroll"
          rowProps={(r) => ({ 'data-metric': r.metric })}
        />
      </div>
      {rows.length > DEFAULT_METRIC_ROWS ? (
        <Button
          size="sm"
          variant="ghost"
          className={styles.more}
          onPress={() => setExpandedRows((v) => !v)}
          aria-expanded={expandedRows}
        >
          {expandedRows ? 'Show fewer metrics' : `Show ${rows.length - DEFAULT_METRIC_ROWS} more metrics`}
        </Button>
      ) : null}
      {pick && pickRow && pickCell && pickPass ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape closes the detail from anywhere inside it
        <section
          className={styles.detail}
          aria-label={`${pick.metric} details${suffix}`}
          data-testid="metric-detail"
          data-metric={pick.metric}
          data-pass={multi ? pick.pass : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !editing) {
              e.stopPropagation();
              setPick(null);
              focusCell(pick.metric, pick.pass);
            }
          }}
        >
          <header className={styles.detailHead}>
            <span className={styles.detailTitle}>{editing ? `Edit ${pick.metric}` : pick.metric}</span>
            {multi ? <Tag kind="count">Pass {pick.pass}</Tag> : null}
            {pickCell.edited ? (
              !multi ? (
                <EditedBadge row={row} metric={pick.metric} meta={meta} canEdit={canEdit} />
              ) : (
                <Tag tone="warning" title={editTooltip(meta)}>
                  edited
                </Tag>
              )
            ) : null}
            <span className={styles.detailActions}>
              {editable ? (
                <IconButton
                  label={`Edit ${pick.metric} score${suffix}`}
                  icon="edit"
                  onPress={() => setEditing((v) => !v)}
                />
              ) : null}
              <IconButton
                label={`Close ${pick.metric} details`}
                icon="close"
                onPress={() => {
                  setPick(null);
                  setEditing(false);
                  focusCell(pick.metric, pick.pass);
                }}
              />
            </span>
          </header>
          {editing ? (
            <ScoreEditor
              runId={runId}
              filePath={payload.run.file_path ?? payload.run.run_id}
              row={row}
              metric={pick.metric}
              spec={model.metricSpecs[pick.metric]}
              initial={
                pickCell.value === null
                  ? ''
                  : pickCell.type === 'score'
                    ? String(Math.round(pickCell.value * 1000) / 10) + '%'
                    : String(pickCell.value)
              }
              passNumber={multi ? pick.pass : model.viewPass}
              passVersion={model.passRevision}
              edited={pickCell.edited}
              onDone={() => setEditing(false)}
            />
          ) : hasMetaDetail(meta, ui.hiddenMetricFields) ? (
            <MetaList meta={meta} hidden={ui.hiddenMetricFields} />
          ) : (
            <p className={styles.empty}>No details were recorded for this metric.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
