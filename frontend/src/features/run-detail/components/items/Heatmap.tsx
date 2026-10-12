/** Item × pass heatmap of the analysis metric for repeat runs, virtualized (brief 04 J4). */
import { useMemo, useRef } from 'react';
import { useScrollMargin, useShellScroller } from '../../hooks/useScrollMargin';
import { useVirtualizer } from '@tanstack/react-virtual';
import { metricBand } from '@/lib/metrics';
import { scopeRowToPass } from '../../lib/passScope';
import { metricCell } from '../../lib/rowDisplay';
import type { FilteredItem } from '../../lib/filterRules';
import { useRunPage } from '../../RunContext';
import styles from './Heatmap.module.css';

const ROW = 32;

export function Heatmap({
  items,
  onOpen,
}: {
  items: FilteredItem[];
  onOpen: (itemId: string, pass: number) => void;
}) {
  const { model, api } = useRunPage();
  const metric = api.selectedMetric;
  const passes = useMemo(() => Array.from({ length: model.samples }, (_, i) => i + 1), [model.samples]);
  const scroller = useShellScroller();
  const listRef = useRef<HTMLDivElement>(null);
  const margin = useScrollMargin(listRef, scroller);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW,
    overscan: 14,
    scrollMargin: margin,
    getItemKey: (i) => items[i]?.row.item_id ?? i,
  });
  if (!metric) return null;
  const cols = `minmax(120px, 1fr) repeat(${passes.length}, 72px)`;
  return (
    <div className={styles.wrap}>
      <div className={styles.scroll}>
        <div
          className={styles.grid}
          role="grid"
          aria-label={`${metric} by item and pass`}
          aria-rowcount={items.length + 1}
          aria-colcount={passes.length + 1}
          style={{ minWidth: 364 + 72 * passes.length }}
        >
          <div className={styles.row} role="row" style={{ gridTemplateColumns: cols }}>
            <span role="columnheader" className={styles.th}>
              Item
            </span>
            {passes.map((p) => (
              <span role="columnheader" key={p} className={styles.th}>
                Pass {p}
              </span>
            ))}
          </div>
          <div ref={listRef} className={styles.body} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const item = items[v.index]!;
              return (
                <div
                  key={v.key}
                  role="row"
                  aria-rowindex={v.index + 2}
                  className={styles.row}
                  style={{
                    gridTemplateColumns: cols,
                    height: ROW,
                    transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)`,
                  }}
                >
                  <span role="gridcell" className={styles.label} title={item.row.item_id}>
                    #{item.row.index + 1} <span className={styles.id}>{item.row.item_id}</span>
                  </span>
                  {passes.map((p) => {
                    const cell = metricCell(api.ctx, scopeRowToPass(item.row, model.metricNames, p), metric);
                    const band = cell.error ? null : metricBand(cell.value, cell.type, cell.direction);
                    return (
                      <span role="gridcell" key={p}>
                        <button
                          type="button"
                          className={styles.cell}
                          data-band={band ?? undefined}
                          data-error={cell.error ?? undefined}
                          aria-label={`Item #${item.row.index + 1} pass ${p}: ${cell.error ? 'error' : cell.text}`}
                          onClick={() => onOpen(item.row.item_id, p)}
                        >
                          {cell.error ? '⚠' : cell.text}
                        </button>
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
