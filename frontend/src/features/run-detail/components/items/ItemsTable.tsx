/**
 * The item table on the shared DataTable: windowed rows on the shell scroller (virtualized), expandable
 * item cards, sortable headers, the `?item=` deep link landing, pagination that keeps the `page` param.
 * Review group R2: no Reason column (C017); scores are centred numbers with no bar in 120px columns, plain green or
 * red where the metric has a pass threshold (C149, C220); Status is a StatusMark with no fill; the open-trace
 * action is a green tile with the trace glyph in a normal last column (C230); one header line, no group band (C253).
 */
import { useMemo, useRef, useState } from 'react';
import { useShellScroller, useStickyOffset } from '../../hooks/useScrollMargin';
import {
  DataTable,
  DatasetTag,
  IconButton,
  ScoreValue,
  Skeleton,
  StatusMark,
  Tooltip,
  type Column,
  type Key,
  type SortState,
  type StatusShape,
  type StatusTone,
} from '@/ui';
import { readLocal, writeLocal } from '@/lib/storage';
import { textDirAttrs } from '@/lib/text';
import { metricPassesFor, type FilteredItem, type SortBy } from '../../lib/filterRules';
import { metricHasPassThreshold } from '../../lib/runModel';
import { latencyLabel, metricCell, rowStatus } from '../../lib/rowDisplay';
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

/** The Status column's StatusMark for an item outcome: the pixel figure is the non-colour cue. */
const STATUS_MARK: Record<string, [StatusTone, StatusShape]> = {
  pass: ['success', 'check'],
  fail: ['danger', 'cross'],
  error: ['danger', 'cross'],
  not_received: ['warning', 'pause'],
  running: ['info', 'orbit'],
};

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

function sortState(sort: SortBy): SortState {
  if (sort === 'index') return { key: 'index', direction: 'asc' };
  const [key, direction] = sort.split('_') as ['score' | 'latency', 'asc' | 'desc'];
  return { key, direction };
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
  const { api, model, payload, hasGroup } = useRunPage();
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
  const stickyOffset = useStickyOffset();

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
        const [tone, shape] = STATUS_MARK[status.kind] ?? ['neutral', 'ring'];
        return (
          <StatusMark
            tone={tone}
            shape={shape}
            label={status.kind === 'error' ? 'Error' : status.label}
            title={status.title || undefined}
          />
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
    ...orderedMetrics.map(
      (m, i) =>
        ({
          id: `metric:${m}`,
          header: m,
          group: 'Metrics',
          type: 'score' as const,
          align: 'center' as const,
          width: 120,
          priority: (m === selectedMetric || i === 0 ? 2 : 3) as 2 | 3,
          sort: m === selectedMetric ? { key: 'score', first: 'desc' as const } : undefined,
          cell: ({ row }: FilteredItem) => {
            const cell = metricCell(ctx, row, m);
            const passes =
              metricHasPassThreshold(model, m) && cell.value !== null && !cell.error
                ? metricPassesFor(ctx, m, cell.value)
                : null;
            return (
              <ScoreValue
                variant="plain"
                value={cell.value}
                type={cell.type}
                direction={cell.direction}
                error={cell.error}
                text={cell.text}
                verdict={passes === null ? null : passes ? 'pass' : 'fail'}
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
            align: 'center',
            resizable: false,
            hideable: false,
            cell: ({ row }) =>
              row.trace_id ? (
                <Tooltip content="Open trace">
                  <IconButton
                    label={`Open trace of item #${row.index + 1}`}
                    icon="trace"
                    tile
                    onPress={() => ui.openTrace(row.item_id, ctx.model.viewPass)}
                    data-trace-button
                  />
                </Tooltip>
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
        storageKey="run.items.v3"
        groupBand={false}
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
