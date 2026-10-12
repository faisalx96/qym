/** The aligned item list: sticky column header, one collapsed row per item, expansion, pager and the ?item= deep link. */
import { useEffect, useMemo, useRef } from 'react';
import { Pagination } from '@/ui';
import type { Row } from '@/features/run-detail/types';
import { letterOf, useCompare } from '../../CompareContext';
import { metricCellFor, pillState } from '../../lib/rowCells';
import { deltaKind } from '../../lib/baseline';
import { RunDot } from '../common';
import { ItemDetail } from './ItemDetail';
import { useItemsUi } from './ItemsUi';
import styles from './ItemList.module.css';

export const PAGE_SIZE = 20;
const HEAT_FROM = 5;

function Pills({
  itemId,
  scores,
  rows,
}: {
  itemId: string;
  scores: Array<number | null>;
  rows: Array<Row | null>;
}) {
  const { model, ctx, baseline } = useCompare();
  const dense = model.runs.length > HEAT_FROM;
  const baseIdx = baseline.runIdxs[0] ?? 0;
  const baseScore = scores[baseIdx] ?? null;
  return (
    <span className={styles.pills} data-dense={dense || undefined}>
      {model.runs.map((run, i) => {
        const p = pillState(run, rows[i] ?? null, ctx);
        const isBase = baseline.runIdxs.includes(i);
        const s = scores[i] ?? null;
        const move =
          !isBase && s !== null && baseScore !== null ? deltaKind(s - baseScore, ctx.direction) : 'same';
        const glyph = p.state === 'pass' ? '✓' : p.state === 'fail' ? '✗' : p.state === 'error' ? '⚠' : '—';
        const row = rows[i] ?? null;
        // Percentage and numeric metrics show their value: "Fail" alone hides 67.7% vs 69.9%.
        const valueText =
          !ctx.isBoolean && row && p.score !== null && p.state !== 'error'
            ? metricCellFor(model, run, row, ctx.metric).text
            : null;
        const word =
          p.state === 'pass'
            ? 'Pass'
            : p.state === 'fail'
              ? 'Fail'
              : p.state === 'error'
                ? 'Error'
                : 'No score';
        return (
          <span
            key={run.ref}
            className={styles.pill}
            data-state={p.state}
            title={`${letterOf(i)} ${run.label}: ${valueText ? `${valueText} ` : ''}${word}${move === 'improved' ? ', better than baseline' : move === 'regressed' ? ', worse than baseline' : ''}`}
          >
            <span aria-hidden>{glyph}</span>
            {dense ? null : <span> {valueText ?? word}</span>}
            {move === 'improved' ? (
              <span aria-hidden className={styles.up}>
                {' '}
                {'▲'}
              </span>
            ) : move === 'regressed' ? (
              <span aria-hidden className={styles.down}>
                {' '}
                {'▼'}
              </span>
            ) : null}
            <span className={styles.srOnly}>
              {letterOf(i)} {valueText ? `${valueText} ` : ''}
              {word}
              {move === 'improved'
                ? ', better than baseline'
                : move === 'regressed'
                  ? ', worse than baseline'
                  : ''}
            </span>
          </span>
        );
      })}
      <span className={styles.srOnly}>{itemId}</span>
    </span>
  );
}

export function ItemList() {
  const { model, items, c, baseline } = useCompare();
  const ui = useItemsUi();
  const page = c.view.page;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clamped = Math.min(page, pageCount);
  const slice = useMemo(() => items.slice((clamped - 1) * PAGE_SIZE, clamped * PAGE_SIZE), [items, clamped]);
  const numberOf = useMemo(() => new Map(model.itemIds.map((id, i) => [id, i + 1])), [model.itemIds]);
  const top = useRef<HTMLDivElement>(null);
  const dense = model.runs.length > HEAT_FROM;

  // A shared ?item= link lands on its page, then scrolls to the row once.
  const target = c.view.item;
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!target) return;
    const at = items.findIndex((i) => i.itemId === target);
    if (at < 0) return;
    const wanted = Math.floor(at / PAGE_SIZE) + 1;
    if (wanted !== clamped) {
      c.setView({ page: wanted }, { keepPage: true });
      return;
    }
    if (scrolled.current === target) return;
    scrolled.current = target;
    ui.toggleExpanded(target, true);
    // Land once; the second pass only corrects a layout shift (details loading) and
    // never fights a reader who has scrolled since.
    let landedAt: number | null = null;
    const land = () => {
      document.getElementById(`item-${target}`)?.scrollIntoView({ block: 'start' });
      landedAt = window.scrollY;
    };
    requestAnimationFrame(land);
    window.setTimeout(() => {
      if (landedAt === null || Math.abs(window.scrollY - landedAt) < 2) land();
    }, 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, items, clamped]);

  if (!items.length) return null;
  return (
    <div ref={top} className={styles.list} data-testid="item-list">
      <div className={styles.head} role="presentation">
        <span className={styles.hIndex}>#</span>
        <span className={styles.hInput}>Input</span>
        <span className={styles.hPills} data-dense={dense || undefined}>
          {model.runs.map((run, i) => (
            <span
              key={run.ref}
              className={styles.hCol}
              title={`${run.label}${baseline.runIdxs.includes(i) ? ' (baseline)' : ''}`}
            >
              <RunDot index={i} />
              {letterOf(i)}
              {baseline.runIdxs.includes(i) ? ' ★' : ''}
            </span>
          ))}
        </span>
      </div>
      <ul className={styles.rows}>
        {slice.map((item, n) => {
          const open = ui.expanded.has(item.itemId);
          const first = item.rows.find((r) => r);
          const position = (clamped - 1) * PAGE_SIZE + n + 1;
          // Under a sort the list position moves; the item keeps its own number.
          const index = numberOf.get(item.itemId) ?? position;
          return (
            <li
              key={item.itemId}
              id={`item-${item.itemId}`}
              className={styles.item}
              data-open={open || undefined}
              data-testid="item-row"
              data-item-id={item.itemId}
            >
              <button
                type="button"
                className={styles.row}
                aria-expanded={open}
                onClick={() => {
                  // A row the reader opened is not a deep link to scroll to when the URL catches up.
                  scrolled.current = item.itemId;
                  ui.toggleExpanded(item.itemId);
                }}
              >
                <span className={styles.srOnly}>
                  Item {index}
                  {position !== index ? ` (row ${position})` : ''}:{' '}
                </span>
                <span className={styles.index} aria-hidden>
                  {index}
                </span>
                <span className={styles.preview}>{first?.input_preview || item.itemId}</span>
                <Pills itemId={item.itemId} scores={item.scores} rows={item.rows} />
              </button>
              {open ? <ItemDetail itemId={item.itemId} /> : null}
            </li>
          );
        })}
      </ul>
      <Pagination
        total={items.length}
        page={clamped}
        pageSize={PAGE_SIZE}
        noun="items"
        scrollTarget={top}
        onPageChange={(p) => c.setView({ page: p }, { keepPage: true })}
      />
    </div>
  );
}
