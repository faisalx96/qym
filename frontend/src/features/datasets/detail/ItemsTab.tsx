/**
 * Dataset → Items tab (brief 07 §2.5): server-paged / sorted / searched table
 * with metric columns; private test sets show the locked state and never
 * request items.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Key } from 'react-aria-components';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  useDatasetItems,
  fetchMatchingItemIds,
  useDeleteItem,
  type Dataset,
  type DatasetItem,
  type DatasetVersion,
} from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { textDirAttrs } from '@/lib/text';
import { copyText } from '@/lib/copy';
import {
  Button,
  Chip,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Icon,
  promptPreview,
  ScoreBar,
  SearchField,
  TagsCell,
  useToast,
  type Column,
  type RowAction,
} from '@/ui';
import { formatLatency, formatJson } from '../lib/itemValue';
import { metricDir } from '../lib/metricDir';
import { ITEM_PAGE_SIZES, datasetPath, itemSortKey, parseDatasetRoute, parseItemSort } from '../lib/route';
import styles from './ItemsTab.module.css';

export interface ItemsTabProps {
  slug: string;
  dataset: Dataset;
  version: DatasetVersion;
  readOnly: boolean;
  onAddItem: () => void;
  onImport: () => void;
  /** Optional multi-select (bulk actions) — provided by the editing model. */
  selection?: { selected: Set<Key>; onChange: (keys: Set<Key>) => void; mode?: 'multiple' | 'single' };
  /** Content of the selection bar (bulk delete etc.). */
  bulkActions?: ReactNode;
  /** Row activation (Enter / click on the row body). Defaults to opening the item page. */
  onOpenItem?: (item: DatasetItem) => void;
  /** Rows currently shown (for pane prev/next). */
  onRows?: (rows: DatasetItem[]) => void;
  /** Called after a single-row delete succeeds (the workspace closes a pane showing that item). */
  onDeleted?: (itemId: string) => void;
  /** Search or label filter changed: the workspace drops its row selection. */
  onFilterChange?: () => void;
}

export function ItemsTab({
  slug,
  dataset,
  version,
  readOnly,
  onAddItem,
  onImport,
  selection,
  bulkActions,
  onOpenItem,
  onRows,
  onDeleted,
  onFilterChange,
}: ItemsTabProps) {
  const [params, setParams] = useSearchParams();
  const route = parseDatasetRoute(dataset.slug, params);
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState(route.search);
  const [deleting, setDeleting] = useState<DatasetItem | null>(null);
  const del = useDeleteItem(slug, dataset.slug, version.version);
  const isDraft = version.status === 'draft';
  const canEdit = isDraft && !readOnly;
  const visible = dataset.items_visible;

  // Debounced server search mirrored to ?search= (page reset).
  useEffect(() => {
    if (search === route.search) return;
    const t = setTimeout(() => {
      onFilterChange?.();
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (search.trim()) next.set('search', search.trim());
          else next.delete('search');
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    }, 200);
    return () => clearTimeout(t);
  }, [search, route.search, setParams, onFilterChange]);

  const query = useDatasetItems(
    slug,
    dataset.slug,
    version.version,
    {
      limit: route.pageSize,
      offset: route.page * route.pageSize,
      search: route.search || undefined,
      sort: route.sort || undefined,
      label: route.label || undefined,
    },
    visible,
  );
  const showSkeleton = useDelayedPending(query.isPending && visible);
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const metrics = query.data?.metric_names ?? [];
  const directions = query.data?.metric_directions ?? {};
  useEffect(() => {
    onRows?.(items);
  }, [items, onRows]);
  const hasUserIds = useMemo(() => items.some((i) => i.item_id && !/^item-\d+$/.test(i.item_id)), [items]);
  const sort = parseItemSort(route.sort);

  async function selectAll() {
    if (!selection || !query.data) return;
    try {
      const ids = await fetchMatchingItemIds(
        slug,
        dataset.slug,
        version.version,
        { search: route.search || undefined, label: route.label || undefined },
        query.data.total,
      );
      selection.onChange(new Set(ids));
    } catch {
      toast.show('Couldn’t select all matching items', { tone: 'error' });
    }
  }

  function setQuery(updates: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(updates)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  }

  const itemHref = (item: DatasetItem) => {
    const next = new URLSearchParams(params);
    next.set('item', item.item_id);
    next.delete('tab');
    next.delete('page');
    return `${datasetPath(slug, dataset.slug)}?${next.toString()}`;
  };

  if (!visible) {
    return (
      <EmptyState
        icon={<Icon name="lock" />}
        title="Private test set"
        body="Item contents are hidden from non-admins. Versions, runs and scores stay visible."
      />
    );
  }

  if (query.data && query.data.total === 0 && !route.search && !route.label) {
    return (
      <div>
        {isDraft ? (
          <EmptyState
            title="This draft is empty"
            body="Add items one at a time or import a CSV / JSON / JSONL file."
            action={
              canEdit ? (
                <div className={styles.emptyActions}>
                  <Button variant="primary" onPress={onAddItem}>
                    + Add item
                  </Button>
                  <Button variant="neutral" onPress={onImport}>
                    Import file
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <EmptyState title="This version has no items" />
        )}
      </div>
    );
  }

  const openItem = (item: DatasetItem) => (onOpenItem ?? ((i: DatasetItem) => navigate(itemHref(i))))(item);

  const columns: Column<DatasetItem>[] = [
    {
      id: 'index',
      header: '#',
      type: 'number',
      sort: 'index',
      width: 64,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (item) => (
        <Link
          to={itemHref(item)}
          className={styles.indexLink}
          data-item-link={item.item_id}
          onKeyDown={(e) => {
            // Keyboard activation opens the docked pane; a click on the link opens the item page.
            if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
              e.preventDefault();
              openItem(item);
            }
          }}
        >
          {item.index}
        </Link>
      ),
    },
    ...(hasUserIds
      ? [
          {
            id: 'item_id',
            header: 'ID',
            type: 'id',
            sort: 'item_id',
            width: 140,
            priority: 2,
            cell: (item: DatasetItem) => <span dir="ltr">{item.item_id}</span>,
          } satisfies Column<DatasetItem>,
        ]
      : []),
    {
      id: 'input',
      header: 'Input',
      sort: 'input',
      flex: true,
      minWidth: 220,
      wrap: 2,
      priority: 1,
      cell: (item) => <Preview value={item.input} wrap />,
    },
    {
      id: 'expected',
      header: 'Expected',
      sort: 'expected',
      flex: true,
      minWidth: 180,
      wrap: 2,
      priority: 2,
      cell: (item) => <Preview value={item.expected_output} wrap />,
    },
    {
      id: 'metadata',
      header: 'Metadata',
      sort: 'metadata',
      width: 180,
      priority: 3,
      cell: (item) => <Preview value={item.metadata} />,
    },
    {
      id: 'labels',
      header: 'Labels',
      type: 'tags',
      width: 160,
      priority: 3,
      defaultHidden: true,
      cell: (item) => <TagsCell tags={item.labels ?? []} />,
    },
    {
      id: 'runs',
      header: 'Runs',
      type: 'number',
      sort: 'runs',
      width: 70,
      priority: 3,
      cell: (item) => item.run_count ?? item.result_summary?.run_count ?? 0,
    },
    ...metrics.map((m): Column<DatasetItem> => ({
      id: `metric:${m}`,
      header: m,
      group: 'Metrics',
      type: 'score',
      sort: `metric:${m}`,
      width: 130,
      priority: 2,
      cell: (item) => (
        <ScoreBar
          value={item.result_summary?.metrics?.[m]?.avg ?? null}
          direction={metricDir(directions[m])}
        />
      ),
    })),
    {
      id: 'latency',
      header: 'Latency',
      type: 'duration',
      sort: 'latency',
      width: 90,
      priority: 3,
      cell: (item) => formatLatency(item.result_summary?.avg_latency_ms),
    },
    {
      id: 'edits',
      header: 'Edits',
      type: 'number',
      sort: 'edits',
      width: 70,
      defaultHidden: true,
      cell: (item) => item.edit_count ?? 0,
    },
  ];

  const rowActions = (): RowAction<DatasetItem>[] => [
    { id: 'open', label: 'Open item', icon: 'external', primary: true, onPress: openItem },
    {
      id: 'copy',
      label: 'Copy as JSON',
      onPress: (it) =>
        void copyText(
          formatJson({
            item_id: it.item_id,
            input: it.input,
            expected_output: it.expected_output,
            metadata: it.metadata,
            labels: it.labels,
          }),
        ).then((ok) =>
          toast.show(ok ? 'Copied item as JSON' : 'Copy failed', { tone: ok ? 'success' : 'error' }),
        ),
    },
    ...(canEdit
      ? [
          {
            id: 'delete',
            label: 'Delete item',
            danger: true,
            onPress: (it: DatasetItem) => setDeleting(it),
          },
        ]
      : []),
  ];

  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / route.pageSize));
  const filtered = Boolean(route.search || route.label);
  return (
    <div className={styles.wrap} data-items-tab aria-busy={query.isFetching || undefined}>
      <DataTable<DatasetItem>
        aria-label={`Items in ${version.version}`}
        storageKey="datasets.items.v3"
        density="compact"
        rows={items}
        rowKey={(i) => i.item_id}
        columns={columns}
        sort={sort}
        onSortChange={(s) => setQuery({ sort: s ? itemSortKey(s.key, s.direction) : null, page: null })}
        onRowOpen={openItem}
        rowActions={rowActions}
        selection={
          selection
            ? {
                ...selection,
                selectAllMatching:
                  total > items.length
                    ? { total, noun: 'items', onSelectAll: () => void selectAll() }
                    : undefined,
              }
            : undefined
        }
        bulkActions={bulkActions}
        loading={showSkeleton}
        refreshing={query.isFetching && query.isPlaceholderData}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        isFiltered={filtered}
        empty={query.data ? <EmptyState compact title="No items" /> : undefined}
        filteredEmpty={
          <EmptyState
            compact
            title="No items match these filters"
            action={
              <Button variant="neutral" onPress={() => setSearch('')}>
                Clear search
              </Button>
            }
          />
        }
        className={styles.table}
      >
        <DataTable.Toolbar
          search={
            <SearchField
              label="Search items"
              hideLabel
              placeholder="Search items…"
              value={search}
              onChange={setSearch}
              width={260}
              data-testid="items-search"
            />
          }
          chips={
            route.label ? (
              <Chip
                isSelected
                onRemove={() => {
                  onFilterChange?.();
                  setQuery({ label: null, page: null });
                }}
                removeLabel="Clear label filter"
              >
                label: {route.label}
              </Chip>
            ) : null
          }
          count={
            query.data ? (
              <span aria-live="polite">
                {query.data.total.toLocaleString()} {query.data.total === 1 ? 'item' : 'items'}
                {route.search ? ` matching “${route.search}”` : ''}
              </span>
            ) : null
          }
          trailing={
            canEdit ? (
              <Button variant="neutral" size="sm" icon={<Icon name="plus" size={12} />} onPress={onAddItem}>
                Add item
              </Button>
            ) : null
          }
        />
        <DataTable.Footer
          trailing={
            canEdit ? (
              <Button variant="ghost" size="sm" icon={<Icon name="plus" size={12} />} onPress={onAddItem}>
                Add new item
              </Button>
            ) : null
          }
          pagination={{
            total,
            page: route.page + 1,
            pageCount,
            pageSize: route.pageSize,
            pageSizeOptions: ITEM_PAGE_SIZES,
            noun: 'items',
            onPageChange: (p) => setQuery({ page: p <= 1 ? null : String(p - 1) }),
            onPageSizeChange: (s) => setQuery({ size: s === 50 ? null : String(s), page: null }),
          }}
        />
      </DataTable>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete item ${deleting?.item_id ?? ''}?`}
        description="The item is removed from this draft. Published versions keep their copy."
        confirmLabel="Delete item"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await del.mutateAsync(deleting.item_id);
            toast.show(`Item ${deleting.item_id} deleted`, { tone: 'success' });
            onDeleted?.(deleting.item_id);
            setDeleting(null);
          } catch (e) {
            toast.show(e instanceof ApiError ? e.detail || e.message : 'Delete failed', { tone: 'error' });
            throw e;
          }
        }}
      />
    </div>
  );
}

/** Mono one-line preview; Arabic text flows RTL. Hovering for 700 ms shows the full value. */
export function Preview({ value, wrap }: { value: unknown; wrap?: boolean }) {
  const text = promptPreview(value);
  const dir = textDirAttrs(text);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hide = () => {
    window.clearTimeout(timer.current);
    setTip(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span
      className={wrap ? styles.previewWrap : styles.preview}
      {...dir}
      onMouseEnter={(e) => {
        if (!text) return;
        const r = e.currentTarget.getBoundingClientRect();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setTip({ x: r.left, y: r.bottom + 4 }), 700);
      }}
      onMouseLeave={hide}
    >
      {text || <span className={styles.empty}>—</span>}
      {tip
        ? createPortal(
            <div
              className={styles.hoverTip}
              role="tooltip"
              style={{
                left: Math.max(8, Math.min(tip.x, window.innerWidth - 488)),
                top: Math.min(tip.y, window.innerHeight - 248),
              }}
              {...dir}
              data-cell-popover
            >
              {typeof value === 'string' ? value : formatJson(value)}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
