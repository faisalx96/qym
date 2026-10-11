/**
 * The item table: virtualized rows (react-virtual on the shell scroller), one
 * real button per row for keyboard, expandable cards, sortable headers with
 * aria-sort on the header cell, pagination that keeps the legacy `page` param.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useScrollMargin, useShellScroller } from '../../hooks/useScrollMargin';
import { Icon, IconButton, Pagination, ScoreValue, Tag } from '@/ui';
import { formatLatency } from '@/lib/metrics';
import { readLocal, writeLocal } from '@/lib/storage';
import { textDirAttrs } from '@/lib/text';
import { useItemReasons, rowReason } from '../../hooks/useItemReasons';
import type { FilteredItem, FilterContext, SortBy } from '../../lib/filterRules';
import { metricCell, rowFailureInput, rowStatus } from '../../lib/rowDisplay';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { ItemCard } from './ItemCard';
import { useItemsUi } from './ItemsUi';
import styles from './ItemsTable.module.css';

const PAGE_SIZE_KEY = 'qym:run-page-size';
const PAGE_SIZES = [20, 50, 100, 500];
const FIXED = {
  expand: 28,
  index: 48,
  status: 84,
  latency: 72,
  trace: 32,
  input: 120,
  reason: 140,
  metric: 88,
  gap: 8,
};
const REASON_MIN_WIDTH = 760;

function usePageSize(): [number, (n: number) => void] {
  const [size, setSize] = useState(() => {
    const n = Number(readLocal(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(n) ? n : 20;
  });
  return [
    size,
    (n) => {
      writeLocal(PAGE_SIZE_KEY, String(n));
      setSize(n);
    },
  ];
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(900);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

interface RowProps {
  item: FilteredItem;
  ctx: FilterContext;
  metric: string | null;
  metrics: string[];
  showReason: boolean;
  index: number;
  open: boolean;
  highlight: boolean;
  reasonRequest: (ids: string[]) => void;
  serverReason: ReturnType<typeof useItemReasons>['serverReasons'];
  metricKeys: Record<string, string[]>;
  readOnly: boolean;
}

const ItemRow = memo(function ItemRow({
  item,
  ctx,
  metric,
  metrics,
  showReason,
  index,
  open,
  highlight,
  reasonRequest,
  serverReason,
  metricKeys,
}: RowProps) {
  const { row } = item;
  const ui = useItemsUi();
  const status = rowStatus(ctx, row, metric);
  const failing = status.kind === 'fail' || status.kind === 'error';
  const failure = metric ? rowFailureInput(ctx, row, metric) : null;
  const reason =
    metric && failure && failing
      ? rowReason({
          row,
          metric,
          scoreText: failure.scoreText,
          needText: failure.needText,
          metaKeys: metricKeys[metric] ?? [],
          serverReason: serverReason.get(row.item_id),
        })
      : null;
  useEffect(() => {
    if (reason?.askServer) reasonRequest([row.item_id]);
  }, [reason?.askServer, reasonRequest, row.item_id]);
  const title = row.input_full ?? row.input ?? row.input_preview ?? '';
  const titleText = (typeof title === 'string' ? title : JSON.stringify(title)).replace(/\s+/g, ' ').trim();
  const retries = row.retry_count ?? 0;
  const bodyId = `item-card-${row.item_id}`;
  return (
    <div
      className={styles.rowWrap}
      data-open={open || undefined}
      data-highlight={highlight || undefined}
      data-item-id={row.item_id}
      data-status={status.kind}
    >
      <div
        className={styles.row}
        role="row"
        aria-rowindex={index + 2}
        data-failed={status.kind === 'error' || undefined}
      >
        <span role="cell" className={styles.rowButtonCell}>
          <button
            type="button"
            className={styles.rowButton}
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            aria-label={`${open ? 'Close' : 'Open'} item #${row.index + 1}`}
            onClick={() => ui.toggleExpanded(row.item_id)}
          />
        </span>
        <span role="cell" className={styles.cellExpand} aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
        <span role="cell" className={styles.cellIndex} title={`ID: ${row.item_id}`}>
          #{row.index + 1}
        </span>
        <span role="cell" className={styles.cellStatus}>
          <Tag
            tone={
              status.kind === 'pass'
                ? 'success'
                : status.kind === 'fail' || status.kind === 'error'
                  ? 'danger'
                  : status.kind === 'not_received'
                    ? 'warning'
                    : status.kind === 'running'
                      ? 'info'
                      : undefined
            }
            title={status.title || undefined}
          >
            {status.kind === 'error' ? '⚠ Error' : status.label}
          </Tag>
        </span>
        <span role="cell" className={styles.cellInput} title={titleText} {...textDirAttrs(titleText)}>
          {titleText || '—'}
        </span>
        {showReason ? (
          <span role="cell" className={styles.cellReason} title={reason?.picked.text}>
            {reason ? (
              <>
                <span className={styles.reasonText}>{reason.picked.text}</span>
                <span className={styles.reasonSource}>{reason.picked.source}</span>
              </>
            ) : null}
          </span>
        ) : null}
        {metrics.map((m) => {
          const cell = metricCell(ctx, row, m);
          return (
            <span role="cell" key={m} className={styles.cellMetric} data-selected={m === metric || undefined}>
              <ScoreValue
                value={cell.value}
                type={cell.type}
                direction={cell.direction}
                error={cell.error}
                text={cell.text}
              />
            </span>
          );
        })}
        <span role="cell" className={styles.cellLatency}>
          {row.latency_ms ? formatLatency(row.latency_ms) : '—'}
          {retries > 0 ? (
            <span className={styles.retry} title={`${retries} retr${retries === 1 ? 'y' : 'ies'}`}>
              ↻{retries}
            </span>
          ) : null}
        </span>
        <span role="cell" className={styles.cellTrace}>
          {row.trace_id ? (
            <IconButton
              label={`Open trace of item #${row.index + 1}`}
              icon="list"
              onPress={() => ui.openTrace(row.item_id, ctx.model.viewPass)}
              data-trace-button
            />
          ) : null}
        </span>
      </div>
      {open ? (
        <div role="row">
          <div role="cell" id={bodyId} className={styles.card}>
            <ItemCard row={row} />
          </div>
        </div>
      ) : null}
    </div>
  );
});

export interface ItemsTableProps {
  items: FilteredItem[];
  page: number;
  onPage: (page: number) => void;
  onSort: (sort: SortBy) => void;
  sort: SortBy;
  sectionRef: React.RefObject<HTMLElement | null>;
}

export function ItemsTable({ items, page, onPage, onSort, sort, sectionRef }: ItemsTableProps) {
  const { api, model, runId, readOnly, payload } = useRunPage();
  const ui = useItemsUi();
  const { ctx, selectedMetric } = api;
  const [pageSize, setPageSize] = usePageSize();
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );
  const scroller = useShellScroller();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(listRef, scroller);
  const width = useWidth(wrapRef);
  const reasons = useItemReasons(runId, selectedMetric, model.viewPass);

  const showReason = width >= REASON_MIN_WIDTH;
  const fixedCols = [
    FIXED.expand,
    FIXED.index,
    FIXED.status,
    FIXED.input,
    ...(showReason ? [FIXED.reason] : []),
    FIXED.latency,
    FIXED.trace,
  ];
  const fixedWidth = fixedCols.reduce((a, b) => a + b, 0) + fixedCols.length * FIXED.gap + 2 * FIXED.gap;
  const fit = Math.max(1, Math.floor((width - fixedWidth) / (FIXED.metric + FIXED.gap)));
  const metrics = useMemo(() => {
    const names = model.metricNames;
    if (names.length <= fit) return names;
    const keep = new Set<string>(selectedMetric ? [selectedMetric] : []);
    names.forEach((n) => keep.size < fit && keep.add(n));
    return names.filter((n) => keep.has(n));
  }, [model.metricNames, fit, selectedMetric]);
  const template = `${FIXED.expand}px ${FIXED.index}px ${FIXED.status}px minmax(${FIXED.input}px, 1.3fr) ${showReason ? `minmax(${FIXED.reason}px, 1fr) ` : ''}repeat(${metrics.length}, ${FIXED.metric}px) ${FIXED.latency}px ${FIXED.trace}px`;

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: pageItems.length,
    getScrollElement: () => scroller,
    estimateSize: () => 44,
    overscan: 8,
    scrollMargin,
    getItemKey: (i) => pageItems[i]?.row.item_id ?? i,
  });

  // A requested scroll (deep link, trace close) brings that row into view under the page top.
  const { scrollTarget, clearScroll } = ui;
  useEffect(() => {
    if (!scrollTarget) return;
    const idx = pageItems.findIndex((p) => p.row.item_id === scrollTarget);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: 'start' });
      const t = setTimeout(() => {
        // measured heights settle after the first jump; align once more
        virtualizer.scrollToIndex(idx, { align: 'start' });
        clearScroll();
      }, 200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [scrollTarget, pageItems, virtualizer, clearScroll]);

  const sortHeader = (label: string, asc: SortBy, desc: SortBy) => {
    const active = sort === asc ? 'ascending' : sort === desc ? 'descending' : 'none';
    return (
      <span role="columnheader" aria-sort={active} className={styles.th} key={label}>
        <button
          type="button"
          className={styles.sortButton}
          onClick={() => onSort(sort === desc ? asc : desc)}
        >
          {label}
          <span aria-hidden="true" className={styles.sortGlyph}>
            {active === 'ascending' ? '▲' : active === 'descending' ? '▼' : '↕'}
          </span>
        </button>
      </span>
    );
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={styles.scroll}>
        <div
          className={styles.table}
          role="table"
          aria-label="Items"
          aria-rowcount={pageItems.length + 1}
          style={{ ['--cols' as string]: template }}
        >
          <div className={styles.head} role="row" aria-rowindex={1}>
            <span role="columnheader" className={styles.th}>
              <span className={styles.srOnly}>Expand</span>
            </span>
            <span
              role="columnheader"
              aria-sort={sort === 'index' ? 'ascending' : 'none'}
              className={styles.th}
            >
              <button type="button" className={styles.sortButton} onClick={() => onSort('index')}>
                #
              </button>
            </span>
            <span role="columnheader" className={styles.th}>
              Status
            </span>
            <span role="columnheader" className={styles.th}>
              Input
            </span>
            {showReason ? (
              <span role="columnheader" className={styles.th}>
                Reason{selectedMetric ? ` · ${selectedMetric}` : ''}
              </span>
            ) : null}
            {metrics.map((m) =>
              m === selectedMetric ? (
                sortHeader(m, 'score_asc', 'score_desc')
              ) : (
                <span role="columnheader" className={styles.th} key={m}>
                  {m}
                </span>
              ),
            )}
            {sortHeader('Latency', 'latency_asc', 'latency_desc')}
            <span role="columnheader" className={styles.th}>
              <span className={styles.srOnly}>Trace</span>
            </span>
          </div>
          <div
            ref={listRef}
            className={styles.body}
            role="rowgroup"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((v) => {
              const item = pageItems[v.index]!;
              return (
                <div
                  key={v.key}
                  ref={virtualizer.measureElement}
                  data-index={v.index}
                  className={styles.virtualRow}
                  style={{ transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
                >
                  <ItemRow
                    item={item}
                    ctx={ctx}
                    metric={selectedMetric}
                    metrics={metrics}
                    showReason={showReason}
                    index={v.index}
                    open={ui.expanded.has(item.row.item_id)}
                    highlight={ui.highlight === item.row.item_id}
                    reasonRequest={reasons.request}
                    serverReason={reasons.serverReasons}
                    metricKeys={payload.snapshot.metric_meta_keys ?? {}}
                    readOnly={readOnly}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {items.length === 0 ? <div className={styles.empty}>No items match the current filters.</div> : null}
      <Pagination
        total={items.length}
        page={current}
        pageSize={pageSize}
        noun="items"
        pageSizeOptions={PAGE_SIZES}
        onPageChange={onPage}
        onPageSizeChange={(n) => {
          setPageSize(n);
          onPage(1);
        }}
        scrollTarget={sectionRef}
      />
    </div>
  );
}

export { PAGE_SIZES };
export type { Row };
