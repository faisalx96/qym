/** The aligned item list (round 8): a card per item with one score chip per run; a row opens into the side-by-side detail. */
import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { Icon, Pagination } from '@/ui';
import { metricBand } from '@/lib/metrics';
import type { Row } from '@/features/run-detail/types';
import { letterOf, runColor, useCompare } from '../../CompareContext';
import { metricCellFor, pillState } from '../../lib/rowCells';
import { deltaKind } from '../../lib/baseline';
import type { FilteredItem } from '../../lib/filters';
import { useRunMark } from '../RunTag';
import { ItemDetail } from './ItemDetail';
import { useItemsUi } from './ItemsUi';
import styles from './ItemList.module.css';

export const PAGE_SIZE = 20;

const WORD = { pass: 'Pass', fail: 'Fail', error: 'Task error', none: 'No score' } as const;

/** One run's score for one item: swatch, letter and the value in the score band (a task error is its own red shape). */
function ScoreChip({ item, runIdx }: { item: FilteredItem; runIdx: number }) {
  const { model, ctx, baseline } = useCompare();
  const run = model.runs[runIdx]!;
  const row: Row | null = item.rows[runIdx] ?? null;
  const p = pillState(run, row, ctx);
  const baseScore = item.scores[baseline.runIdxs[0] ?? 0] ?? null;
  const s = item.scores[runIdx] ?? null;
  const isBase = baseline.runIdxs.includes(runIdx);
  const move = !isBase && s !== null && baseScore !== null ? deltaKind(s - baseScore, ctx.direction) : 'same';
  const view = row && p.score !== null && p.state !== 'error' ? metricCellFor(model, run, row, ctx.metric) : null;
  const mark = useRunMark(runIdx);
  const band = view ? metricBand(view.value, view.type, view.direction) : null;
  const moveWord =
    move === 'improved' ? ', better than baseline' : move === 'regressed' ? ', worse than baseline' : '';
  const spoken = `${letterOf(runIdx)} ${view ? `${view.text} ` : ''}${WORD[p.state]}${moveWord}`;
  return (
    <span
      className={styles.chip}
      style={{ '--run': runColor(runIdx) } as CSSProperties}
      data-part="item-score-chip"
      data-state={p.state}
      data-band={band ?? undefined}
      title={`${run.label}: ${spoken.slice(2)}`}
      {...mark}
    >
      <span className={styles.swatch} aria-hidden />
      <span className={styles.letter} aria-hidden>
        {letterOf(runIdx)}
      </span>
      {p.state === 'error' ? (
        <>
          <Icon name="close" size={12} />
          <span className={styles.srOnly}>task error</span>
        </>
      ) : (
        <>
          <span aria-hidden>{view ? view.text : '—'}</span>
          <span className={styles.srOnly}>{spoken}</span>
        </>
      )}
    </span>
  );
}

export function ItemList() {
  const { model, items, c, baseline, ctx } = useCompare();
  const ui = useItemsUi();
  const page = c.view.page;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clamped = Math.min(page, pageCount);
  const slice = useMemo(() => items.slice((clamped - 1) * PAGE_SIZE, clamped * PAGE_SIZE), [items, clamped]);
  const numberOf = useMemo(() => new Map(model.itemIds.map((id, i) => [id, i + 1])), [model.itemIds]);
  const positionOf = useMemo(
    () => new Map(slice.map((it, n) => [it.itemId, (clamped - 1) * PAGE_SIZE + n + 1])),
    [slice, clamped],
  );
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

  // A row the reader opened is not a deep link to scroll to when the URL catches up.
  const onToggle = (id: string) => {
    scrolled.current = id;
    ui.toggleExpanded(id);
  };

  if (!items.length) return null;

  const hasError = (it: FilteredItem) =>
    model.runs.some((run, i) => pillState(run, it.rows[i] ?? null, ctx).state === 'error');
  void baseline;

  return (
    <div className={styles.list} data-testid="item-list" data-part="item-list">
      <ul className={styles.rows} aria-label="Items across the compared runs">
        {slice.map((it) => {
          const index = numberOf.get(it.itemId) ?? positionOf.get(it.itemId) ?? 0;
          const open = ui.expanded.has(it.itemId);
          return (
            <li
              key={it.itemId}
              id={`item-${it.itemId}`}
              className={styles.item}
              data-testid="item-row"
              data-part="item-row"
              data-item-id={it.itemId}
              data-open={open ? '' : undefined}
              data-error={hasError(it) ? '' : undefined}
            >
              <div
                className={styles.head}
                role="button"
                tabIndex={0}
                aria-expanded={open}
                data-part="item-head"
                onClick={() => onToggle(it.itemId)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(it.itemId);
                  }
                }}
              >
                <span className={styles.chev} data-part="item-chevron" aria-hidden>
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
                </span>
                <span className={styles.no} data-part="item-index">
                  #{index}
                </span>
                <span className={styles.title} data-part="item-title">
                  {it.rows.find((r) => r)?.input_preview || it.itemId}
                </span>
                <span className={styles.chips} data-part="item-score-chips">
                  {model.runs.map((run, i) => (
                    <ScoreChip key={run.ref} item={it} runIdx={i} />
                  ))}
                </span>
              </div>
              {open ? (
                <div className={styles.detailHold}>
                  <ItemDetail itemId={it.itemId} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className={styles.pager} data-part="pagination">
        <Pagination
          total={items.length}
          page={clamped}
          pageSize={PAGE_SIZE}
          noun="items"
          onPageChange={(p) => c.setView({ page: p }, { keepPage: true })}
        />
      </div>
    </div>
  );
}
