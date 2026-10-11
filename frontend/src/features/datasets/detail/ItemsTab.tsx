/**
 * Dataset → Items tab (brief 07 §2.5): server-paged / sorted / searched table
 * with metric columns; private test sets show the locked state and never
 * request items.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useDatasetItems, useDeleteItem, type Dataset, type DatasetItem, type DatasetVersion } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { textDirAttrs } from '@/lib/text';
import { copyText } from '@/lib/copy';
import { Button, Chip, ConfirmDialog, DataTable, DropdownMenu, EmptyState, ErrorState, Icon, IconButton, Pagination, ScoreValue, SearchField, Skeleton, Text, useToast } from '@/ui';
import { formatLatency, formatJson, previewValue } from '../lib/itemValue';
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
  /** Row activation (Enter / click on the row body). Defaults to opening the item page. */
  onOpenItem?: (item: DatasetItem) => void;
}

export function ItemsTab({ slug, dataset, version, readOnly, onAddItem, onImport, selection, onOpenItem }: ItemsTabProps) {
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
  }, [search, route.search, setParams]);

  const query = useDatasetItems(
    slug,
    dataset.slug,
    version.version,
    { limit: route.pageSize, offset: route.page * route.pageSize, search: route.search || undefined, sort: route.sort || undefined, label: route.label || undefined },
    visible,
  );
  const showSkeleton = useDelayedPending(query.isPending && visible);
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const metrics = query.data?.metric_names ?? [];
  const directions = query.data?.metric_directions ?? {};
  const hasUserIds = useMemo(() => items.some((i) => i.item_id && !/^item-\d+$/.test(i.item_id)), [items]);
  const sort = parseItemSort(route.sort);

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

  const toolbar = (
    <div className={styles.toolbar}>
      <div className={styles.toolbarStart}>
        <SearchField label="Search items" hideLabel placeholder="Search items…" value={search} onChange={setSearch} width={260} data-testid="items-search" />
        {route.label ? (
          <Chip isSelected onRemove={() => setQuery({ label: null, page: null })} removeLabel="Clear label filter">
            label: {route.label}
          </Chip>
        ) : null}
        {query.data ? (
          <Text as="span" variant="sm" tone="muted" aria-live="polite">
            {query.data.total.toLocaleString()} {query.data.total === 1 ? 'item' : 'items'}
            {route.search ? ` matching “${route.search}”` : ''}
          </Text>
        ) : null}
      </div>
      <div className={styles.toolbarEnd}>
        {canEdit ? (
          <Button variant="neutral" size="sm" icon={<Icon name="plus" size={12} />} onPress={onAddItem}>
            Add item
          </Button>
        ) : null}
      </div>
    </div>
  );

  if (showSkeleton) {
    return (
      <div>
        {toolbar}
        <Skeleton kind="table" rows={8} label="Loading items" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <div>
        {toolbar}
        <ErrorState error={query.error} title="Couldn’t load items" onRetry={() => void query.refetch()} />
      </div>
    );
  }
  if (!query.data) return toolbar;

  if (query.data.total === 0 && !route.search && !route.label) {
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

  const columns = [
    {
      id: 'index',
      label: '#',
      sortKey: 'index',
      width: 64,
      mono: true,
      align: 'end' as const,
      cell: (item: DatasetItem) => (
        <Link to={itemHref(item)} className={styles.indexLink} data-item-link={item.item_id}>
          {item.index}
        </Link>
      ),
    },
    ...(hasUserIds ? [{ id: 'item_id', label: 'ID', sortKey: 'item_id', width: 140, mono: true, cell: (item: DatasetItem) => <span dir="ltr">{item.item_id}</span> }] : []),
    { id: 'input', label: 'Input', sortKey: 'input', flex: true, minWidth: 220, cell: (item: DatasetItem) => <Preview value={item.input} /> },
    { id: 'expected', label: 'Expected', sortKey: 'expected', flex: true, minWidth: 180, cell: (item: DatasetItem) => <Preview value={item.expected_output} /> },
    { id: 'metadata', label: 'Metadata', sortKey: 'metadata', width: 180, cell: (item: DatasetItem) => <Preview value={item.metadata} /> },
    { id: 'runs', label: 'Runs', sortKey: 'runs', width: 70, align: 'end' as const, mono: true, cell: (item: DatasetItem) => item.run_count ?? item.result_summary?.run_count ?? 0 },
    ...metrics.map((m) => ({
      id: `metric:${m}`,
      label: m,
      sortKey: `metric:${m}`,
      width: 110,
      align: 'end' as const,
      mono: true,
      cell: (item: DatasetItem) => <ScoreValue value={item.result_summary?.metrics?.[m]?.avg ?? null} direction={metricDir(directions[m])} />,
    })),
    { id: 'latency', label: 'Latency', sortKey: 'latency', width: 90, align: 'end' as const, mono: true, cell: (item: DatasetItem) => formatLatency(item.result_summary?.avg_latency_ms) },
    { id: 'edits', label: 'Edits', sortKey: 'edits', width: 70, align: 'end' as const, mono: true, cell: (item: DatasetItem) => item.edit_count ?? 0 },
    {
      id: 'actions',
      label: 'Actions',
      hideLabel: true,
      width: 44,
      align: 'end' as const,
      cell: (item: DatasetItem) => (
        <DropdownMenu
          label={`Actions for item ${item.item_id}`}
          trigger={<IconButton label={`Actions for item ${item.item_id}`} icon="more" />}
          items={[
            { id: 'open', label: 'Open item' },
            { id: 'copy', label: 'Copy as JSON' },
            ...(canEdit ? [{ id: 'delete', label: 'Delete item', tone: 'danger' as const, separatorBefore: true }] : []),
          ]}
          onAction={(id) => {
            if (id === 'open') (onOpenItem ?? ((i: DatasetItem) => navigate(itemHref(i))))(item);
            else if (id === 'copy') {
              void copyText(formatJson({ item_id: item.item_id, input: item.input, expected_output: item.expected_output, metadata: item.metadata, labels: item.labels })).then((ok) =>
                toast.show(ok ? 'Copied item as JSON' : 'Copy failed', { tone: ok ? 'success' : 'error' }),
              );
            } else if (id === 'delete') setDeleting(item);
          }}
        />
      ),
    },
  ];

  const pageCount = Math.max(1, Math.ceil(query.data.total / route.pageSize));
  return (
    <div className={styles.wrap} data-items-tab aria-busy={query.isFetching || undefined}>
      {toolbar}
      {items.length === 0 ? (
        <EmptyState compact title="No items match these filters" action={<Button variant="neutral" onPress={() => setSearch('')}>Clear search</Button>} />
      ) : (
        <DataTable<DatasetItem>
          aria-label={`Items in ${version.version}`}
          storageKey="datasets.items.v2"
          rows={items}
          rowKey={(i) => i.item_id}
          columns={columns}
          sort={sort}
          onSortChange={(s) => setQuery({ sort: itemSortKey(s.key, s.direction), page: null })}
          onRowAction={(_k, item) => (onOpenItem ?? ((i: DatasetItem) => navigate(itemHref(i))))(item)}
          selection={selection}
          dimmed={query.isFetching && query.isPlaceholderData}
          className={styles.table}
        />
      )}
      <div className={styles.footer}>
        {canEdit ? (
          <Button variant="ghost" size="sm" icon={<Icon name="plus" size={12} />} onPress={onAddItem}>
            Add new item
          </Button>
        ) : (
          <span />
        )}
        <Pagination
          total={query.data.total}
          page={route.page + 1}
          pageCount={pageCount}
          pageSize={route.pageSize}
          pageSizeOptions={ITEM_PAGE_SIZES}
          noun="items"
          onPageChange={(p) => setQuery({ page: p <= 1 ? null : String(p - 1) })}
          onPageSizeChange={(s) => setQuery({ size: s === 50 ? null : String(s), page: null })}
        />
      </div>
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

/** Mono one-line preview; Arabic text flows RTL. */
export function Preview({ value }: { value: unknown }) {
  const text = previewValue(value);
  const dir = textDirAttrs(typeof value === 'string' ? value : text);
  return (
    <span className={styles.preview} {...dir} title={text.length > 60 ? text : undefined}>
      {text || <span className={styles.empty}>—</span>}
    </span>
  );
}
