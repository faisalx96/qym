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
  Badge,
  Button,
  Chip,
  ConfirmDialog,
  DataTable,
  DropdownMenu,
  EmptyState,
  Icon,
  promptPreview,
  ScoreBar,
  SearchField,
  SegmentedControl,
  TagsCell,
  useToast,
  type Column,
  type RowAction,
} from '@/ui';
import { formatLatency, formatJson } from '../lib/itemValue';
import { menuLabel } from '../lib/batchCopy';
import { STATE_OPTIONS, stateCount, stateTotalText, stateUrlValue, type StateFilter } from '../lib/itemState';
import {
  addMetaFilter,
  metaChipLabel,
  metaFiltersToParams,
  metaModesToParams,
  parseMetaFilters,
  removeMetaFilter,
  type MetaFilter,
} from '../lib/metaFilter';
import type { BatchAction } from '@/api/datasets';
import type { BatchCriteria } from '../lib/batchCopy';
import { MetadataFilter } from './MetadataFilter';
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
  /** Search, label, state or metadata filter changed: the workspace drops its row selection. */
  onFilterChange?: () => void;
  /** Published version: opens the create-draft flow ("Create a draft to edit items"). */
  onCreateDraft?: () => void;
  /** "All matching" menu: open the batch dialog for the current criteria. */
  onBatch?: (action: BatchAction, criteria: BatchCriteria) => void;
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
  onCreateDraft,
  onBatch,
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
  const metaFilters = useMemo(
    () => parseMetaFilters(route.meta, route.metaMode),
    [route.meta, route.metaMode],
  );
  const metaParams = useMemo(() => metaFiltersToParams(metaFilters), [metaFilters]);
  const metaModes = useMemo(() => metaModesToParams(metaFilters), [metaFilters]);

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
      state: route.state === 'active' ? undefined : route.state,
      meta: metaParams.length ? metaParams : undefined,
      meta_mode: metaModes.length ? metaModes : undefined,
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
        {
          search: route.search || undefined,
          label: route.label || undefined,
          state: route.state === 'active' ? undefined : route.state,
          meta: metaParams.length ? metaParams : undefined,
          meta_mode: metaModes.length ? metaModes : undefined,
        },
        query.data.total,
      );
      selection.onChange(new Set(ids));
    } catch {
      toast.show('Couldn’t select all matching items', { tone: 'error' });
    }
  }

  // QA1-29: after Add filter focus lands on the new chip, after a removal on the Metadata button. The popover
  // returns focus to its trigger when it closes, so the move waits one task.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    const timer = setTimeout(() => {
      const el =
        target === ''
          ? document.querySelector<HTMLElement>('[data-testid="metadata-filter"]')
          : document.querySelector<HTMLElement>(
              `[data-testid="meta-chip"][data-meta-path="${CSS.escape(target)}"]`,
            );
      el?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [metaFilters]);

  function setMeta(next: MetaFilter[], focusPath = '') {
    pendingFocus.current = focusPath;
    onFilterChange?.();
    setParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.delete('meta');
        params.delete('meta_mode');
        for (const value of metaFiltersToParams(next)) params.append('meta', value);
        for (const value of metaModesToParams(next)) params.append('meta_mode', value);
        params.delete('page');
        return params;
      },
      { replace: true },
    );
  }

  function clearFilters() {
    onFilterChange?.();
    setSearch('');
    setParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        for (const key of ['search', 'label', 'meta', 'meta_mode', 'page']) params.delete(key);
        return params;
      },
      { replace: true },
    );
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

  const noCriteria = !route.search && !route.label && metaFilters.length === 0;
  const counts = query.data?.counts;
  if (
    query.data &&
    query.data.total === 0 &&
    noCriteria &&
    route.state === 'active' &&
    (counts?.all ?? 0) === 0
  ) {
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
    ...(hasUserIds || route.state !== 'active'
      ? [
          {
            id: 'item_id',
            header: 'ID',
            type: 'id',
            sort: 'item_id',
            width: route.state !== 'active' ? 180 : 140,
            priority: 2,
            cell: (item: DatasetItem) => (
              <span className={styles.idCell}>
                <span dir="ltr">{item.item_id}</span>
                {item.state === 'disabled' ? <Badge tone="neutral">Disabled</Badge> : null}
              </span>
            ),
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
  const filtered = !noCriteria;
  const canBatch = canEdit && !noCriteria && onBatch;
  const criteria: BatchCriteria = {
    search: route.search || undefined,
    label: route.label || undefined,
    meta: metaFilters,
  };
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
        rowProps={(item) => ({ 'data-state': item.state === 'disabled' ? 'disabled' : undefined })}
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
        empty={
          query.data ? (
            route.state === 'disabled' ? (
              <EmptyState
                compact
                title="No disabled items"
                body="Items you disable in a draft appear here."
              />
            ) : (
              <EmptyState compact title="No items" />
            )
          ) : undefined
        }
        filteredEmpty={
          <EmptyState
            compact
            title="No items match these filters"
            action={
              <Button variant="neutral" onPress={clearFilters}>
                Clear filters
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
          filters={
            <>
              <MetadataFilter
                slug={slug}
                datasetRef={dataset.slug}
                version={version.version}
                filters={metaFilters}
                onAdd={(f) => setMeta(addMetaFilter(metaFilters, f), f.path)}
              />
              <span data-testid="items-state">
                <SegmentedControl<StateFilter>
                  label="Item state"
                  options={STATE_OPTIONS.map((o) => {
                    const n = stateCount(counts, o.id);
                    return {
                      value: o.id,
                      label: (
                        <>
                          {o.label}
                          {n === undefined ? null : <span className={styles.countLabel}>{n}</span>}
                        </>
                      ),
                    };
                  })}
                  value={route.state}
                  onChange={(next) => {
                    onFilterChange?.();
                    setQuery({ state: stateUrlValue(next) ?? null, page: null });
                  }}
                />
              </span>
            </>
          }
          chips={
            route.label || metaFilters.length ? (
              <div className={styles.chipRow} data-testid="filter-chips">
                {route.label ? (
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
                ) : null}
                {metaFilters.map((f) => (
                  <Chip
                    key={f.path}
                    isSelected
                    onRemove={() => setMeta(removeMetaFilter(metaFilters, f))}
                    removeLabel={`Remove filter ${metaChipLabel(f)}`}
                    data-testid="meta-chip"
                    data-meta-path={f.path}
                  >
                    {metaChipLabel(f)}
                  </Chip>
                ))}
              </div>
            ) : null
          }
          count={
            query.data ? (
              <span aria-live="polite">
                {stateTotalText(route.state, counts, query.data.total)}
                {route.search ? ` matching “${route.search}”` : ''}
              </span>
            ) : null
          }
          trailing={
            <>
              {!readOnly && !noCriteria && !isDraft && onCreateDraft ? (
                <Button
                  variant="neutral"
                  size="sm"
                  onPress={onCreateDraft}
                  data-testid="batch-published-entry"
                >
                  Create a draft to edit items
                </Button>
              ) : null}
              {canBatch ? (
                <DropdownMenu
                  label="Actions on all matching items"
                  trigger={
                    <Button
                      variant="neutral"
                      size="sm"
                      iconEnd={<Icon name="chevron-down" size={12} />}
                      data-testid="all-matching"
                    >
                      All matching
                    </Button>
                  }
                  items={[
                    {
                      id: 'disable',
                      label: menuLabel('disable', counts?.active ?? 0),
                      disabled: !counts?.active,
                    },
                    {
                      id: 'enable',
                      label: menuLabel('enable', counts?.disabled ?? 0),
                      disabled: !counts?.disabled,
                    },
                    {
                      id: 'delete',
                      label: menuLabel('delete', counts?.all ?? 0),
                      tone: 'danger',
                      separatorBefore: true,
                      disabled: !counts?.all,
                    },
                  ]}
                  onAction={(id) => onBatch(id as BatchAction, criteria)}
                />
              ) : null}
              {canEdit ? (
                <Button variant="neutral" size="sm" icon={<Icon name="plus" size={12} />} onPress={onAddItem}>
                  Add item
                </Button>
              ) : null}
            </>
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
