/** The aligned item matrix (DataTable): `#`, input, one score column per run, expansion, pager and the ?item= deep link. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, DataTable, ScoreBar, type Column, type Key } from '@/ui';
import type { Row } from '@/features/run-detail/types';
import { letterOf, useCompare } from '../../CompareContext';
import { metricCellFor, pillState } from '../../lib/rowCells';
import { deltaKind } from '../../lib/baseline';
import type { FilteredItem } from '../../lib/filters';
import { useShellScroller } from '@/features/run-detail/hooks/useScrollMargin';
import { RunDot } from '../common';
import { ItemDetail } from './ItemDetail';
import { useItemsUi } from './ItemsUi';
import styles from './ItemList.module.css';

export const PAGE_SIZE = 20;
const HEAT_FROM = 5;

const WORD = { pass: 'Pass', fail: 'Fail', error: 'Error', none: 'No score' } as const;
const GLYPH = { pass: '✓', fail: '✗', error: '⚠', none: '—' } as const;

/** One run's score for one item: bar (percentage/numeric), Pass/Fail/Error chip (boolean), a compact pill when dense. */
function RunCell({ item, runIdx, numericMax }: { item: FilteredItem; runIdx: number; numericMax: number }) {
  const { model, ctx, baseline } = useCompare();
  const dense = model.runs.length > HEAT_FROM;
  const run = model.runs[runIdx]!;
  const row: Row | null = item.rows[runIdx] ?? null;
  const p = pillState(run, row, ctx);
  const baseScore = item.scores[baseline.runIdxs[0] ?? 0] ?? null;
  const s = item.scores[runIdx] ?? null;
  const isBase = baseline.runIdxs.includes(runIdx);
  const move = !isBase && s !== null && baseScore !== null ? deltaKind(s - baseScore, ctx.direction) : 'same';
  const view =
    !ctx.isBoolean && row && p.score !== null && p.state !== 'error'
      ? metricCellFor(model, run, row, ctx.metric)
      : null;
  const word = WORD[p.state];
  const moveWord =
    move === 'improved' ? ', better than baseline' : move === 'regressed' ? ', worse than baseline' : '';
  const spoken = `${letterOf(runIdx)} ${view ? `${view.text} ` : ''}${word}${moveWord}`;
  const cue =
    move === 'improved' ? (
      <span aria-hidden className={styles.up}>
        {'▲'}
      </span>
    ) : move === 'regressed' ? (
      <span aria-hidden className={styles.down}>
        {'▼'}
      </span>
    ) : null;
  let body;
  if (dense || p.state === 'none') {
    body = (
      <span className={styles.pill} data-state={p.state} aria-hidden>
        {GLYPH[p.state]}
        {dense && view ? ` ${view.text}` : null}
      </span>
    );
  } else if (ctx.isBoolean || p.state === 'error') {
    body = (
      <Badge tone={p.state === 'pass' ? 'success' : p.state === 'fail' ? 'danger' : 'warning'} aria-hidden>
        {GLYPH[p.state]} {word}
      </Badge>
    );
  } else {
    const numeric = model.types[ctx.metric] === 'numeric';
    body = (
      <ScoreBar
        value={view?.value ?? null}
        type={view?.type}
        direction={view?.direction}
        max={numeric ? numericMax : undefined}
        text={view?.text}
      />
    );
  }
  return (
    <span className={styles.cell} data-state={p.state} title={`${run.label}: ${spoken.slice(2)}`}>
      <span aria-hidden={dense ? undefined : true}>{body}</span>
      {cue}
      <span className={styles.srOnly}>{spoken}</span>
    </span>
  );
}

export function ItemList() {
  const { model, items, c, baseline, ctx } = useCompare();
  const ui = useItemsUi();
  const shell = useShellScroller();
  // The header sticks under whatever compare chrome is currently stuck above the list.
  const measureStickyTop = useCallback(() => {
    if (!shell) return 0;
    const top = shell.getBoundingClientRect().top;
    let max = 0;
    document.querySelectorAll<HTMLElement>('[data-compare-sticky], [data-compare-toolbar]').forEach((el) => {
      if (getComputedStyle(el).position === 'sticky')
        max = Math.max(max, el.getBoundingClientRect().bottom - top);
    });
    return max;
  }, [shell]);
  const page = c.view.page;
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clamped = Math.min(page, pageCount);
  const slice = useMemo(() => items.slice((clamped - 1) * PAGE_SIZE, clamped * PAGE_SIZE), [items, clamped]);
  const numberOf = useMemo(() => new Map(model.itemIds.map((id, i) => [id, i + 1])), [model.itemIds]);
  const positionOf = useMemo(
    () => new Map(slice.map((it, n) => [it.itemId, (clamped - 1) * PAGE_SIZE + n + 1])),
    [slice, clamped],
  );
  const dense = model.runs.length > HEAT_FROM;
  // The detail row spans the whole (scrollable) table; its content stays as wide as the visible list.
  const hasItems = items.length > 0;
  const listRef = useRef<HTMLDivElement>(null);
  const [listWidth, setListWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const measure = () => setListWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasItems]);
  const numericMax = useMemo(() => {
    let m = 0;
    for (const it of items) for (const s of it.scores) if (s !== null && s > m) m = s;
    return m || 1;
  }, [items]);
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

  const columns: Column<FilteredItem>[] = [
    {
      id: 'index',
      header: '#',
      priority: 2,
      type: 'number',
      align: 'start',
      mono: true,
      width: 56,
      resizable: false,
      cell: (it) => {
        const index = numberOf.get(it.itemId) ?? positionOf.get(it.itemId) ?? 0;
        const position = positionOf.get(it.itemId) ?? index;
        return (
          <>
            <span className={styles.srOnly}>
              Item {index}
              {position !== index ? ` (row ${position})` : ''}:{' '}
            </span>
            <span aria-hidden>{index}</span>
          </>
        );
      },
    },
    {
      id: 'input',
      header: 'Input',
      cardTitle: true,
      priority: 1,
      flex: true,
      minWidth: 220,
      wrap: 2,
      resizable: false,
      cell: (it) => it.rows.find((r) => r)?.input_preview || it.itemId,
    },
    ...model.runs.map((run, i): Column<FilteredItem> => ({
      id: letterOf(i),
      header: (
        <span className={styles.runHead}>
          <RunDot index={i} />
          {letterOf(i)}
          {baseline.runIdxs.includes(i) ? <span aria-label="baseline"> ★</span> : null}
        </span>
      ),
      label: `${letterOf(i)}${baseline.runIdxs.includes(i) ? ' (baseline)' : ''}`,
      priority: 2,
      hint: `${run.label}${baseline.runIdxs.includes(i) ? ' (baseline)' : ''}`,
      width: dense ? 76 : 148,
      resizable: false,
      cell: (it) => <RunCell item={it} runIdx={i} numericMax={numericMax} />,
    })),
  ];

  const stateOf = (it: FilteredItem) => {
    let warn = false;
    const baseScore = it.scores[baseline.runIdxs[0] ?? 0] ?? null;
    for (let i = 0; i < model.runs.length; i++) {
      const p = pillState(model.runs[i]!, it.rows[i] ?? null, ctx);
      if (p.state === 'error') return 'error' as const;
      const s = it.scores[i] ?? null;
      if (
        !baseline.runIdxs.includes(i) &&
        s !== null &&
        baseScore !== null &&
        deltaKind(s - baseScore, ctx.direction) === 'regressed'
      )
        warn = true;
    }
    return warn ? ('warn' as const) : undefined;
  };

  return (
    <div
      ref={listRef}
      className={styles.list}
      style={listWidth ? ({ '--list-w': `${listWidth}px` } as React.CSSProperties) : undefined}
      data-testid="item-list"
      data-dense={dense || undefined}
    >
      <DataTable<FilteredItem>
        aria-label="Items across the compared runs"
        columns={columns}
        rows={slice}
        rowKey={(it) => it.itemId}
        density="regular"
        densityLocked
        columnMenu={false}
        stickyParent={shell}
        stickyTop={measureStickyTop}
        zebra={false}
        rowState={stateOf}
        rowProps={(it) => ({ id: `item-${it.itemId}`, 'data-testid': 'item-row', 'data-item-id': it.itemId })}
        renderExpanded={(it) => (
          <div className={styles.detailHold}>
            <ItemDetail itemId={it.itemId} />
          </div>
        )}
        expandOnRowClick
        expandLabel={(it, open) => `${open ? 'Collapse' : 'Expand'} item ${numberOf.get(it.itemId) ?? ''}`}
        expanded={ui.expanded as Set<Key>}
        onExpandedChange={(next) => {
          for (const id of next) if (!ui.expanded.has(String(id))) onToggle(String(id));
          for (const id of ui.expanded) if (!next.has(id)) onToggle(id);
        }}
      >
        <DataTable.Footer
          pagination={{
            total: items.length,
            page: clamped,
            pageSize: PAGE_SIZE,
            noun: 'items',
            onPageChange: (p) => c.setView({ page: p }, { keepPage: true }),
          }}
        />
      </DataTable>
    </div>
  );
}
