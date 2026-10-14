/** Deep analysis: metric correlation matrix and the strongest relationship scatter (brief 04 J3). */
import { useMemo, useRef, useState } from 'react';
import { Select } from '@/ui';
import { useRunPage } from '../../RunContext';
import { rowPassesFor, rowScoreFor } from '../../lib/filterRules';
import { correlationMatrix, strongestPair } from '../../lib/overviewModel';
import { Scatter } from '../charts/Charts';
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
  const relationRef = useRef<HTMLElement>(null);
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
  // few metrics: cells stay square-ish instead of stretching to the page width
  const cols =
    names.length <= 8
      ? `minmax(6rem, 10rem) repeat(${names.length}, minmax(0, 9rem))`
      : `minmax(0, 1fr) repeat(${names.length}, minmax(0, 1fr))`;
  const opts = names.map((n, i) => ({ key: String(i), label: n }));
  return (
    <div className={styles.single}>
      <section className={styles.stack} aria-label="Metric correlation">
        <h3 className={styles.groupTitle}>Metric correlation</h3>
        <p className={styles.note}>
          Pearson correlation across matched item scores. Select a cell to plot the pair.
        </p>
        <div
          className={styles.matrix}
          style={{ gridTemplateColumns: cols }}
          role="grid"
          aria-label="Pearson correlation matrix"
        >
          <div role="row" style={{ display: 'contents' }}>
            <span role="presentation" />
            {names.map((n) => (
              <span key={n} role="columnheader" className={styles.matrixHead} title={n}>
                {n}
              </span>
            ))}
          </div>
          {names.map((rowName, i) => (
            <div key={rowName} role="row" style={{ display: 'contents' }}>
              <span role="rowheader" className={styles.matrixHead} title={rowName}>
                {rowName}
              </span>
              {names.map((colName, j) => {
                const v = matrix.r[i]?.[j] ?? null;
                return (
                  <span role="gridcell" key={colName}>
                    <button
                      type="button"
                      className={chart.matrixCell}
                      style={{ width: '100%', background: tone(v) }}
                      aria-label={`${rowName} versus ${colName}: ${v === null ? 'not enough data' : v.toFixed(2)}`}
                      aria-pressed={i === xi && j === yi}
                      disabled={i === j}
                      onClick={() => {
                        setPair([j, i]);
                        requestAnimationFrame(() =>
                          relationRef.current?.scrollIntoView({
                            block: 'nearest',
                            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                              ? 'auto'
                              : 'smooth',
                          }),
                        );
                      }}
                    >
                      {v === null ? '—' : v.toFixed(2)}
                    </button>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </section>
      <section ref={relationRef} className={styles.stack} aria-label="Metric relationship">
        <h3 className={styles.groupTitle}>
          Metric relationship{' '}
          <span className={styles.note}>{r === null || r === undefined ? 'r —' : `r ${r.toFixed(2)}`}</span>
        </h3>
        <p className={styles.note}>
          One point per item. Pick two metrics, or select a cell in the matrix above.
        </p>
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
        <Scatter
          points={points}
          xLabel={names[xi] ?? ''}
          yLabel={names[yi] ?? ''}
          onPick={setItem}
          aspect={3}
          fmt={(v) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100))}
        />
      </section>
    </div>
  );
}

function useDeep() {
  const page = useRunPage();
  return { ...page, setItem: (id: string) => page.api.setItemParam(id) };
}
