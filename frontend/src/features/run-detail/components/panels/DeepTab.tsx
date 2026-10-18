/** Deep analysis: metric correlation matrix and the strongest relationship scatter (brief 04 J3). */
import { useMemo, useRef, useState } from 'react';
import { Select } from '@/ui';
import { useRunPage } from '../../RunContext';
import { rowPassesFor, rowScoreFor } from '../../lib/filterRules';
import { correlationMatrix, strongestPair } from '../../lib/overviewModel';
import { Scatter, ScatterLegend, useMeasuredWidth } from '../charts/Charts';
import { ChartCard } from '../charts/ChartCard';
import { MATRIX_NUMBER_MIN, matrixCellSide } from '../charts/chartLabels';
import chart from '../charts/Charts.module.css';
import styles from './Panels.module.css';

function tone(r: number | null): string | undefined {
  if (r === null) return undefined;
  const a = Math.min(1, Math.abs(r));
  return `color-mix(in srgb, ${r >= 0 ? 'var(--chart-2)' : 'var(--chart-4)'} ${Math.round(a * 60)}%, var(--bg-elevated))`;
}

export function DeepTab() {
  const { items, api, model, setItem } = useDeep();
  const rows = useMemo(() => items.map((i) => i.row), [items]);
  const matrix = useMemo(() => correlationMatrix(api.ctx, rows), [api.ctx, rows]);
  const [pair, setPair] = useState<[number, number] | null>(null);
  const relationRef = useRef<HTMLDivElement>(null);
  const names = matrix.metrics;
  const [xi, yi] = pair ?? strongestPair(matrix) ?? [0, 0];
  // The dots carry the same pass / fail tone as the quality-versus-latency scatter: the analysis metric decides.
  const metric = api.selectedMetric;
  const outcomes = useMemo(() => {
    const out = new Map<string, 'pass' | 'fail' | null>();
    const idx = metric ? model.metricNames.indexOf(metric) : -1;
    if (idx < 0 || !metric) return out;
    for (const { row } of items) {
      const passed = rowPassesFor(api.ctx, metric, rowScoreFor(api.ctx, row, idx, metric));
      out.set(row.item_id, passed === null ? null : passed ? 'pass' : 'fail');
    }
    return out;
  }, [items, metric, model.metricNames, api.ctx]);
  const points = useMemo(
    () =>
      matrix.points
        .filter((p) => p.scores[xi] != null && p.scores[yi] != null)
        .map((p) => ({
          id: p.itemId,
          x: p.scores[xi] as number,
          y: p.scores[yi] as number,
          outcome: outcomes.get(p.itemId) ?? null,
        })),
    [matrix, xi, yi, outcomes],
  );
  if (names.length < 2) return <p className={styles.note}>Correlation needs at least two metrics.</p>;
  const r = matrix.r[xi]?.[yi];
  const opts = names.map((n, i) => ({ key: String(i), label: n }));
  return (
    <div className={styles.single}>
      <ChartCard
        title="Metric correlation"
        slot={false}
        meta={
          <span className={styles.note}>
            Pearson r across matched item scores. Select a cell to plot the pair.
          </span>
        }
      >
        <CorrelationMatrix
          names={names}
          r={matrix.r}
          selected={[xi, yi]}
          onPick={(j, i) => {
            setPair([j, i]);
            requestAnimationFrame(() =>
              relationRef.current?.scrollIntoView({
                block: 'nearest',
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
              }),
            );
          }}
        />
      </ChartCard>
      <div ref={relationRef}>
        <ChartCard
          title="Metric relationship"
          slot={false}
          meta={
            <span className={styles.note}>{r === null || r === undefined ? 'r —' : `r ${r.toFixed(2)}`}</span>
          }
          legend={<ScatterLegend points={points} />}
          intro={
            <div className={styles.controls}>
              <Select
                label="X"
                items={opts}
                value={String(xi)}
                onChange={(k) => k !== null && setPair([Number(k), yi])}
                width="14ch"
              />
              <Select
                label="Y"
                items={opts}
                value={String(yi)}
                onChange={(k) => k !== null && setPair([xi, Number(k)])}
                width="14ch"
              />
            </div>
          }
        >
          <Scatter
            points={points}
            xLabel={names[xi] ?? ''}
            yLabel={names[yi] ?? ''}
            onPick={setItem}
            fmt={(v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100))}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function CorrelationMatrix({
  names,
  r,
  selected,
  onPick,
}: {
  names: string[];
  r: Array<Array<number | null>>;
  selected: [number, number];
  onPick: (x: number, y: number) => void;
}) {
  const [boxRef, W] = useMeasuredWidth<HTMLDivElement>(600);
  const side = matrixCellSide(W, names.length);
  const label = 120;
  // round 5 R4-1: the grid fills the card body; cells are as wide as their column (at least 20px) and `side` high
  const colWidth = (W - label - 2 * names.length) / names.length;
  const minWidth = label + names.length * 22;
  return (
    <div ref={boxRef} className={chart.matrixBox} data-testid="correlation-matrix">
      <div
        className={styles.matrix}
        style={{
          gridTemplateColumns: `${label}px repeat(${names.length}, minmax(20px, 1fr))`,
          width: '100%',
          minWidth,
        }}
        role="grid"
        aria-label="Pearson correlation matrix"
      >
        <div role="row" style={{ display: 'contents' }}>
          <span role="presentation" />
          {names.map((n) => (
            <span key={n} role="columnheader" className={chart.matrixColHead} title={n}>
              <span className={chart.matrixColText}>{n}</span>
            </span>
          ))}
        </div>
        {names.map((rowName, i) => (
          <div key={rowName} role="row" style={{ display: 'contents' }}>
            <span role="rowheader" className={styles.matrixHead} title={rowName}>
              {rowName}
            </span>
            {names.map((colName, j) => {
              const v = r[i]?.[j] ?? null;
              return (
                <span role="gridcell" key={colName}>
                  <button
                    type="button"
                    className={chart.matrixCell}
                    style={{ width: '100%', height: side, background: tone(v) }}
                    aria-label={`${rowName} versus ${colName}: ${v === null ? 'not enough data' : v.toFixed(2)}`}
                    aria-pressed={i === selected[0] && j === selected[1]}
                    disabled={i === j}
                    onClick={() => onPick(j, i)}
                  >
                    {colWidth >= MATRIX_NUMBER_MIN ? (v === null ? '—' : v.toFixed(2)) : null}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function useDeep() {
  const page = useRunPage();
  return { ...page, setItem: (id: string) => page.api.setItemParam(id) };
}
