/**
 * The item table on the shared DataTable: windowed rows on the shell scroller (virtualized), expandable
 * item cards, sortable headers, the `?item=` deep link landing, pagination that keeps the `page` param.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShellScroller, useStickyOffset } from '../../hooks/useScrollMargin';
import {
  DataTable,
  DatasetTag,
  IconButton,
  ScoreBar,
  Skeleton,
  Tag,
  type Column,
  type Key,
  type SortState,
} from '@/ui';
import { readLocal, writeLocal } from '@/lib/storage';
import { textDirAttrs } from '@/lib/text';
import { useItemReasons, rowReason } from '../../hooks/useItemReasons';
import type { FilteredItem, FilterContext, SortBy } from '../../lib/filterRules';
import { latencyLabel, metricCell, rowFailureInput, rowStatus } from '../../lib/rowDisplay';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { defaultPageSize } from '../../lib/itemsPaging';
import { isUnionRun } from '../../lib/heroModel';
import { datasetKeyParts, rowDatasetKey, rowRawItemId } from '../../lib/datasetFilter';
import { ItemCard } from './ItemCard';
import { useItemsUi } from './ItemsUi';
import styles from './ItemsTable.module.css';

const PAGE_SIZE_KEY = 'qym:run-page-size';
const PAGE_SIZES = [20, 50, 100, 500];
const REASON_MIN_WIDTH = 760;

function usePageSize(total: number): [number, (n: number) => void] {
  const [chosen, setChosen] = useState<number | null>(() => {
    const n = Number(readLocal(PAGE_SIZE_KEY));
    return PAGE_SIZES.includes(n) ? n : null;
  });
  return [
    chosen ?? defaultPageSize(total),
    (n) => {
      writeLocal(PAGE_SIZE_KEY, String(n));
      setChosen(n);
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

function sortState(sort: SortBy): SortState {
  if (sort === 'index') return { key: 'index', direction: 'asc' };
  const [key, direction] = sort.split('_') as ['score' | 'latency', 'asc' | 'desc'];
  return { key, direction };
}

function ReasonCell({
  item,
  ctx,
  metric,
  metricKeys,
  serverReason,
  request,
}: {
  item: FilteredItem;
  ctx: FilterContext;
  metric: string | null;
  metricKeys: Record<string, string[]>;
  serverReason: ReturnType<typeof useItemReasons>['serverReasons'];
  request: (ids: string[]) => void;
}) {
  const { row } = item;
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
    if (reason?.askServer) request([row.item_id]);
  }, [reason?.askServer, request, row.item_id]);
  if (!reason) return null;
  return (
    <span className={styles.reason} title={reason.picked.text}>
      <span className={styles.reasonText}>{reason.picked.text}</span>
      <span className={styles.reasonSource}>{reason.picked.source}</span>
    </span>
  );
}

export interface ItemsTableProps {
  items: FilteredItem[];
  page: number;
  onPage: (page: number) => void;
  onSort: (sort: SortBy) => void;
  sort: SortBy;
  sectionRef: React.RefObject<HTMLElement | null>;
}

export function ItemsTable({ items, page, onPage, onSort, sort, sectionRef }: ItemsTableProps) {
  const { api, model, runId, payload, hasGroup } = useRunPage();
  const textLoaded = hasGroup('text');
  const ui = useItemsUi();
  const { ctx, selectedMetric } = api;
  const [pageSize, setPageSize] = usePageSize(items.length);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );
  const scroller = useShellScroller();
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapRef);
  const reasons = useItemReasons(runId, selectedMetric, model.viewPass);
  const stickyOffset = useStickyOffset();
  const showReason = width >= REASON_MIN_WIDTH;
  const metricKeys = payload.snapshot.metric_meta_keys ?? {};

  // The analysis metric leads, so it is on screen when the sidebar narrows the table.
  const orderedMetrics = [...model.metricNames].sort(
    (a, b) => Number(b === selectedMetric) - Number(a === selectedMetric),
  );

  const hasTraces = pageItems.some((it) => it.row.trace_id);
  const union = isUnionRun(payload.run);
  const columns: Column<FilteredItem>[] = [
    {
      id: 'index',
      header: '#',
      hint: 'Item number (click to restore the original order)',
      type: 'number',
      width: 64,
      pin: 'start',
      hideable: false,
      sort: { key: 'index', first: 'asc' },
      priority: 1,
      cardTitle: true,
      cell: (it) => <span title={`ID: ${it.row.item_id}`}>#{it.row.index + 1}</span>,
    },
    ...(union
      ? ([
          {
            id: 'dataset',
            header: 'Dataset',
            width: 224,
            priority: 1,
            cell: ({ row }) => {
              const key = rowDatasetKey(row);
              if (!key) return <span aria-hidden="true">—</span>;
              const { name, version } = datasetKeyParts(key);
              return <DatasetTag name={name} version={version} />;
            },
          },
          {
            id: 'item',
            header: 'Item',
            width: 96,
            priority: 2,
            mono: true,
            cell: ({ row }) => <span title={`ID: ${row.item_id}`}>{rowRawItemId(row)}</span>,
          },
        ] satisfies Column<FilteredItem>[])
      : []),
    {
      id: 'status',
      header: 'Status',
      width: 110,
      priority: 1,
      cell: ({ row }) => {
        const status = rowStatus(ctx, row, selectedMetric);
        return (
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
        );
      },
    },
    {
      id: 'input',
      header: 'Input',
      flex: true,
      minWidth: 220,
      wrap: 2,
      priority: 1,
      cell: ({ row }) => {
        const title = row.input_full ?? row.input ?? row.input_preview ?? '';
        const text = (typeof title === 'string' ? title : JSON.stringify(title)).replace(/\s+/g, ' ').trim();
        // the item texts are a later row group: a bone holds the place until it arrives
        if (!text && !textLoaded) return <Skeleton kind="value" width="70%" label="Loading input" />;
        return (
          <span title={text} {...textDirAttrs(text)}>
            {text || '—'}
          </span>
        );
      },
    },
    ...(showReason
      ? [
          {
            id: 'reason',
            header: `Reason${selectedMetric ? ` · ${selectedMetric}` : ''}`,
            width: 260,
            priority: 3 as const,
            cell: (it: FilteredItem) => (
              <ReasonCell
                item={it}
                ctx={ctx}
                metric={selectedMetric}
                metricKeys={metricKeys}
                serverReason={reasons.serverReasons}
                request={reasons.request}
              />
            ),
          } satisfies Column<FilteredItem>,
        ]
      : []),
    ...orderedMetrics.map(
      (m, i) =>
        ({
          id: `metric:${m}`,
          header: m,
          group: 'Metrics',
          type: 'score' as const,
          width: 150,
          priority: (m === selectedMetric || i === 0 ? 2 : 3) as 2 | 3,
          sort: m === selectedMetric ? { key: 'score', first: 'desc' as const } : undefined,
          cell: ({ row }: FilteredItem) => {
            const cell = metricCell(ctx, row, m);
            return (
              <ScoreBar
                value={cell.value}
                type={cell.type}
                direction={cell.direction}
                error={cell.error}
                text={cell.text}
              />
            );
          },
        }) satisfies Column<FilteredItem>,
    ),
    {
      id: 'latency',
      header: 'Latency',
      group: 'System',
      type: 'duration',
      width: 110,
      sort: { key: 'latency', first: 'desc' },
      priority: 2,
      cell: ({ row }) => {
        const retries = row.retry_count ?? 0;
        return (
          <span data-cell="latency">
            {latencyLabel(row.latency_ms)}
            {retries > 0 ? (
              <span className={styles.retry} title={`${retries} retr${retries === 1 ? 'y' : 'ies'}`}>
                {' '}
                ↻{retries}
              </span>
            ) : null}
          </span>
        );
      },
    },
    ...(hasTraces
      ? [
          {
            id: 'trace',
            header: 'Trace',
            hideLabel: true,
            width: 48,
            pin: 'end',
            resizable: false,
            hideable: false,
            cell: ({ row }) =>
              row.trace_id ? (
                <IconButton
                  label={`Open trace of item #${row.index + 1}`}
                  icon="list"
                  onPress={() => ui.openTrace(row.item_id, ctx.model.viewPass)}
                  data-trace-button
                />
              ) : (
                <span className={styles.noTrace} aria-hidden="true">
                  –
                </span>
              ),
          } satisfies Column<FilteredItem>,
        ]
      : []),
  ];

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <DataTable<FilteredItem>
        aria-label="Items"
        storageKey="run.items.v2"
        columns={columns}
        rows={pageItems}
        rowKey={(it) => it.row.item_id}
        density="regular"
        densityLocked
        zebra={false}
        responsive="cards"
        empty="No items match the current filters."
        sort={sortState(sort)}
        allowUnsorted
        onSortChange={(s) => {
          if (!s || s.key === 'index') onSort('index');
          else onSort(`${s.key}_${s.direction}` as SortBy);
        }}
        expanded={ui.expanded as Set<Key>}
        onExpandedChange={(next) => {
          for (const id of next) if (!ui.expanded.has(String(id))) ui.toggleExpanded(String(id), true);
          for (const id of ui.expanded) if (!next.has(id)) ui.toggleExpanded(id, false);
        }}
        expandOnRowClick
        expandLabel={(it, open) => `${open ? 'Close' : 'Open'} item #${it.row.index + 1}`}
        renderExpanded={(it) => <ItemCard row={it.row as Row} />}
        rowState={(it) => (rowStatus(ctx, it.row, selectedMetric).kind === 'error' ? 'error' : undefined)}
        rowProps={(it) => ({
          'data-item-id': it.row.item_id,
          'data-open': ui.expanded.has(it.row.item_id) ? 'true' : undefined,
          'data-highlight': ui.highlight === it.row.item_id ? 'true' : undefined,
          'data-status': rowStatus(ctx, it.row, selectedMetric).kind,
        })}
        rowClassName={(it) => (ui.highlight === it.row.item_id ? styles.highlight : undefined)}
        virtualize={{ estimateRowHeight: 52, scrollParent: scroller, scrollPaddingStart: stickyOffset }}
        scrollToKey={ui.scrollTarget}
        onScrolledToKey={ui.clearScroll}
      >
        <DataTable.Footer
          pagination={{
            total: items.length,
            page: current,
            pageSize,
            noun: 'items',
            pageSizeOptions: PAGE_SIZES,
            onPageChange: onPage,
            onPageSizeChange: (n) => {
              setPageSize(n);
              onPage(1);
            },
            scrollTarget: sectionRef,
          }}
        />
      </DataTable>
    </div>
  );
}

export { PAGE_SIZES };
export type { Row };
