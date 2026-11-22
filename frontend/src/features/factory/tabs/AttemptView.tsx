/**
 * Factory → Generation → one attempt: what the job was asked, how far it got, a chart of the tree it grew (one
 * bar per layer: the depth is the rows, the width the bar, split by the review of its items), and under it the
 * items to review: approve, reject or reset one at a time (row actions, the item popup) or every pending item at
 * once. A click on a layer filters the table to it. The table refetches while the job runs.
 */
import { useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  ACTIVE_JOB_STATUSES,
  JOB_REFRESH_MS,
  useCancelJob,
  useFactoryJob,
  useGeneratedItems,
  useReviewItems,
  type FactoryDetail,
  type GeneratedItem,
  type LayerCounts,
  type ReviewFilter,
  type ReviewState,
} from '@/api/factory';
import { datasetPath } from '@/features/datasets/lib/route';
import { APP_LOCALE, formatAgo } from '@/lib/dates';
import { actionErrorMessage } from '@/lib/http';
import { tableLoading, useDelayedPending } from '@/lib/pending';
import {
  Button,
  Card,
  ChartTooltipHost,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Icon,
  IconButton,
  Mark,
  Pagination,
  SearchField,
  SegmentedControl,
  Select,
  Tag,
  Text,
  TextLink,
  TipBody,
  UserName,
  promptPreview,
  useToast,
  type Column,
} from '@/ui';
import { GeneratedItemDialog } from '../GeneratedItemDialog';
import { jobTitle } from '../FactoryDetailPage';
import { JobStatusMark, paramsText, progressText } from './jobText';
import { ReviewMark } from './reviewMark';
import pageStyles from '../FactoryDetailPage.module.css';
import styles from './AttemptView.module.css';

const ALL = '__all';
const PAGE_SIZE = 50;
const REVIEW_FILTERS: { value: ReviewFilter; label: string; title: string }[] = [
  { value: 'all', label: 'All', title: 'Every item of the attempt' },
  { value: 'pending', label: 'Pending', title: 'Items nobody reviewed yet' },
  { value: 'approved', label: 'Approved', title: 'Items someone approved' },
  { value: 'rejected', label: 'Rejected', title: 'Items someone rejected (disabled in the dataset)' },
];

function n(value: number) {
  return value.toLocaleString(APP_LOCALE);
}

/** One bar per layer: the row is the depth, the bar the width (share of the widest layer), split by review. */
export function LayerChart({
  base,
  layers,
  selected,
  onSelect,
}: {
  base: number;
  layers: LayerCounts[];
  selected: number | null;
  onSelect: (layer: number | null) => void;
}) {
  const widest = Math.max(base, ...layers.map((l) => l.total), 1);
  const rows: { layer: number; total: number; counts: LayerCounts | null; parents: number }[] = [
    { layer: 0, total: base, counts: null, parents: 0 },
    ...layers.map((l, i) => ({ layer: l.layer, total: l.total, counts: l, parents: i === 0 ? base : layers[i - 1]!.total })),
  ];
  return (
    <ChartTooltipHost className={styles.chartCard} data-marks="" data-testid="layer-chart">
      <div className={styles.chartHead}>
        <Text as="h3" variant="lg" weight={600} className={styles.chartTitle}>
          Depth and width
        </Text>
        <span className={styles.legend} aria-hidden="true">
          <span>
            <span className={styles.swatch} data-tone="success" /> Approved
          </span>
          <span>
            <span className={styles.swatch} data-tone="danger" /> Rejected
          </span>
          <span>
            <span className={styles.swatch} data-tone="info" /> Pending
          </span>
        </span>
      </div>
      {layers.length === 0 && base === 0 ? (
        <p className={styles.empty}>No item generated yet.</p>
      ) : (
        <ol className={styles.layers} aria-label="Items per layer">
          {rows.map((row) => {
            const label = row.layer === 0 ? 'Base items' : `Layer ${row.layer}`;
            const perParent = row.parents ? row.total / row.parents : 0;
            const isSelected = row.layer !== 0 && selected === row.layer;
            return (
              <li key={row.layer} className={styles.layerRow} data-testid="layer-row" data-layer={row.layer}>
                {row.layer === 0 ? (
                  <span className={styles.layerLabel}>{label}</span>
                ) : (
                  <button
                    type="button"
                    className={styles.layerLabel}
                    data-selected={isSelected ? '' : undefined}
                    aria-pressed={isSelected}
                    onClick={() => onSelect(isSelected ? null : row.layer)}
                    title={isSelected ? 'Show every layer' : `Show the items of layer ${row.layer}`}
                  >
                    {label}
                  </button>
                )}
                <div className={styles.track} style={{ '--w': `${(row.total / widest) * 100}%` } as React.CSSProperties}>
                  {row.counts ? (
                    (['approved', 'rejected', 'pending'] as const).map((state) => {
                      const count = row.counts![state];
                      if (!count) return null;
                      return (
                        <Mark
                          key={state}
                          as="span"
                          tone={state === 'approved' ? 'success' : state === 'rejected' ? 'danger' : 'info'}
                          className={styles.segment}
                          style={{ flexBasis: `${(count / row.total) * 100}%` }}
                          tip={
                            <TipBody
                              title={label}
                              rows={[
                                [state[0]!.toUpperCase() + state.slice(1), n(count)],
                                ['Items', n(row.total)],
                                ['Per parent', perParent.toLocaleString(APP_LOCALE, { maximumFractionDigits: 1 })],
                              ]}
                            />
                          }
                          aria-label={`${label}: ${n(count)} ${state}`}
                        />
                      );
                    })
                  ) : (
                    <Mark
                      as="span"
                      tone="neutral"
                      className={styles.segment}
                      style={{ flexBasis: '100%' }}
                      tip={<TipBody title="Base items" rows={[['Items', n(row.total)]]} hint="The source items the attempt started from" />}
                      aria-label={`Base items: ${n(row.total)}`}
                    />
                  )}
                </div>
                <span className={styles.count}>
                  <strong>{n(row.total)}</strong>
                  {row.counts
                    ? ` · ${n(row.counts.approved)} approved · ${n(row.counts.rejected)} rejected · ${n(row.counts.pending)} pending`
                    : ' source items'}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </ChartTooltipHost>
  );
}

export function AttemptView({
  factory,
  slug,
  jobId,
  canModify,
  canApprove,
  onBack,
}: {
  factory: FactoryDetail;
  slug: string;
  jobId: string;
  canModify: boolean;
  canApprove: boolean;
  onBack: () => void;
}) {
  const toast = useToast();
  const [review, setReview] = useState<ReviewFilter>('all');
  const [layer, setLayer] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [approvingAll, setApprovingAll] = useState(false);
  const jobQuery = useFactoryJob(factory.id, jobId, { liveWhileActive: true });
  const job = jobQuery.data ?? null;
  const active = Boolean(job && ACTIVE_JOB_STATUSES.includes(job.status));
  const filters = { layer, review, q: q.trim(), limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const list = useGeneratedItems(factory.id, jobId, filters, { refetchInterval: active ? JOB_REFRESH_MS : false });
  const showSkeleton = useDelayedPending(list.isPending);
  const reviewItems = useReviewItems(factory.id, jobId);
  const cancel = useCancelJob(factory.id);
  const items = list.data?.items ?? [];
  const dataset = list.data?.dataset ?? job?.output_dataset ?? null;
  const version = list.data?.dataset_version?.version ?? null;
  const viewingIndex = viewing ? items.findIndex((i) => i.item_id === viewing) : -1;
  const viewingItem = viewingIndex >= 0 ? items[viewingIndex]! : null;
  const isFiltered = Boolean(review !== 'all' || layer !== null || filters.q);

  function setFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  async function reviewOne(item: GeneratedItem, state: ReviewState) {
    setActing(item.item_id);
    try {
      await reviewItems.mutateAsync({ review: state, item_ids: [item.item_id] });
      toast.show(state === 'approved' ? 'Item approved' : state === 'rejected' ? 'Item rejected' : 'Item back to pending', {
        tone: state === 'rejected' ? 'info' : 'success',
      });
    } catch (e) {
      toast.show(actionErrorMessage(`${state === 'pending' ? 'reset' : state === 'approved' ? 'approve' : 'reject'} the item`, e), {
        tone: 'error',
      });
    } finally {
      setActing(null);
    }
  }

  const columns: Column<GeneratedItem>[] = [
    {
      id: 'item',
      header: 'Item',
      width: 220,
      priority: 1,
      cardTitle: true,
      cell: (i) => (
        <Text as="span" mono variant="sm">
          {i.item_id}
        </Text>
      ),
      secondary: (i) => `Layer ${i.layer} · from ${i.parent_item_id}`,
    },
    {
      id: 'rule',
      header: 'Rule applied',
      width: 200,
      priority: 1,
      wrap: true,
      cell: (i) => (i.rule ? <span dir="auto">{i.rule.title}</span> : <span className={pageStyles.muted}>—</span>),
    },
    {
      id: 'input',
      header: 'Input',
      flex: true,
      minWidth: 220,
      priority: 2,
      wrap: true,
      cell: (i) =>
        i.missing ? (
          <span className={pageStyles.muted}>Removed from the dataset</span>
        ) : (
          <span className={styles.preview} dir="auto">
            {promptPreview(i.input, 200)}
          </span>
        ),
    },
    {
      id: 'expected',
      header: 'Expected output',
      flex: true,
      minWidth: 200,
      priority: 3,
      wrap: true,
      cell: (i) =>
        i.missing ? null : (
          <span className={styles.preview} dir="auto">
            {promptPreview(i.expected_output, 160)}
          </span>
        ),
    },
    {
      id: 'review',
      header: 'Review',
      width: 120,
      priority: 1,
      cell: (i) => <ReviewMark review={i.review} />,
      secondary: (i) =>
        i.reviewed_by ? (
          <span>
            <UserName id={i.reviewed_by.id} name={i.reviewed_by.display_name} email={i.reviewed_by.email} />
            {i.reviewed_at ? ` · ${formatAgo(i.reviewed_at)}` : ''}
          </span>
        ) : null,
    },
    ...(canApprove
      ? [
          {
            id: 'actions',
            header: 'Actions',
            hideLabel: true,
            width: 110,
            priority: 1,
            cell: (i: GeneratedItem) => (
              <span className={pageStyles.rowActions}>
                {i.review !== 'approved' ? (
                  <IconButton
                    tile
                    tone="approve"
                    icon="check"
                    label={`Approve ${i.item_id}`}
                    isDisabled={acting === i.item_id || i.missing}
                    onPress={() => void reviewOne(i, 'approved')}
                    data-testid="item-approve"
                  />
                ) : null}
                {i.review !== 'rejected' ? (
                  <IconButton
                    tile
                    tone="reject"
                    icon="close"
                    label={`Reject ${i.item_id}`}
                    isDisabled={acting === i.item_id || i.missing}
                    onPress={() => void reviewOne(i, 'rejected')}
                    data-testid="item-reject"
                  />
                ) : null}
                {i.review !== 'pending' ? (
                  <IconButton
                    tile
                    icon="retry"
                    label={`Put ${i.item_id} back to pending`}
                    isDisabled={acting === i.item_id || i.missing}
                    onPress={() => void reviewOne(i, 'pending')}
                    data-testid="item-reset"
                  />
                ) : null}
              </span>
            ),
          } satisfies Column<GeneratedItem>,
        ]
      : []),
  ];

  const counts = list.data?.review ?? job?.review ?? null;
  return (
    <div className={styles.view} data-testid="attempt-view">
      <div className={styles.head}>
        <Button variant="neutral" icon={<Icon name="chevron-left" size={12} />} onPress={onBack} data-testid="attempt-back">
          All attempts
        </Button>
        <Text as="h2" variant="lg" weight={600} className={styles.title}>
          {job ? jobTitle(job.kind) : 'Generation'}
        </Text>
        {job ? <JobStatusMark job={job} /> : null}
        <span className={styles.headEnd}>
          {active ? <span className={pageStyles.toolbarNote}>Updates automatically</span> : null}
          {dataset ? (
            dataset.deleted ? (
              <span className={pageStyles.muted}>{dataset.name} (deleted)</span>
            ) : (
              <TextLink to={datasetPath(slug, dataset.slug, { tab: 'items' })} data-testid="attempt-dataset">
                {dataset.name}
              </TextLink>
            )
          ) : null}
          {job && canModify && active && job.status !== 'cancel_requested' ? (
            <Button
              variant="neutral"
              icon={<Icon name="stop" size={12} />}
              onPress={() =>
                cancel.mutate(job.id, {
                  onError: (e) => toast.show(actionErrorMessage('cancel the job', e), { tone: 'error' }),
                })
              }
              loading={cancel.isPending}
            >
              Cancel
            </Button>
          ) : null}
        </span>
      </div>
      {job ? (
        <p className={styles.meta} data-testid="attempt-meta">
          <span>{paramsText(job)}</span>
          <span>{progressText(job)}</span>
          {typeof job.progress.already_applied === 'number' && job.progress.already_applied > 0 ? (
            <span title="Rules the model found already at work in the item; another rule was tried in their place">
              {n(job.progress.already_applied)} rule{job.progress.already_applied === 1 ? '' : 's'} skipped as already followed
            </span>
          ) : null}
          {typeof job.progress.failed_calls === 'number' && job.progress.failed_calls > 0 ? (
            <span>{n(job.progress.failed_calls)} failed call{job.progress.failed_calls === 1 ? '' : 's'}</span>
          ) : null}
          {job.requested_by ? (
            <span>
              Started {job.started_at ? formatAgo(job.started_at) : job.created_at ? formatAgo(job.created_at) : ''} by{' '}
              <UserName id={job.requested_by.id} name={job.requested_by.display_name} email={job.requested_by.email} />
            </span>
          ) : null}
          {job.status === 'failed' && job.error ? <span>Failed: {job.error}</span> : null}
        </p>
      ) : null}
      <Card>
        <LayerChart
          base={list.data?.base_items ?? Number(job?.progress.base_items ?? 0)}
          layers={list.data?.layers ?? []}
          selected={layer}
          onSelect={setFilter(setLayer)}
        />
      </Card>
      <div className={pageStyles.toolbar}>
        <SearchField
          label="Search items"
          hideLabel
          placeholder="Item text or id"
          value={q}
          onChange={setFilter(setQ)}
          onClear={() => setFilter(setQ)('')}
        />
        <Select
          label="Layer"
          hideLabel
          items={[
            { key: ALL, label: 'All layers' },
            ...(list.data?.layers ?? []).map((l) => ({ key: String(l.layer), label: `Layer ${l.layer}` })),
          ]}
          value={layer === null ? ALL : String(layer)}
          onChange={(key: Key | null) => setFilter(setLayer)(key && key !== ALL ? Number(key) : null)}
          searchable={false}
          triggerVariant="bar"
          showValue="always"
        />
        <SegmentedControl<ReviewFilter> label="Review" value={review} onChange={setFilter(setReview)} options={REVIEW_FILTERS} />
        <span className={pageStyles.toolbarEnd}>
          {counts ? (
            <Text as="span" variant="sm" tone="muted" data-testid="attempt-counts">
              {n(counts.approved)} approved · {n(counts.rejected)} rejected · {n(counts.pending)} pending
            </Text>
          ) : null}
          {canApprove && counts && counts.pending > 0 ? (
            <Button
              variant="primary"
              icon={<Icon name="check" size={12} />}
              onPress={() => setApprovingAll(true)}
              isDisabled={active}
              disabledReason={active ? 'Wait for the job to finish' : undefined}
              data-testid="approve-all"
            >
              Approve all pending
            </Button>
          ) : null}
        </span>
      </div>
      {!canApprove && !list.isPending && items.length ? (
        <Text as="p" variant="sm" tone="muted">
          Someone with the approve level reviews the items; a rejected item is disabled in the dataset.
        </Text>
      ) : null}
      <DataTable<GeneratedItem>
        aria-label="Generated items"
        rows={items}
        rowKey={(i) => i.item_id}
        columns={columns}
        density="comfortable"
        loading={tableLoading(list.isPending, showSkeleton)}
        refreshing={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        errorTitle="Couldn’t load the items"
        onRowOpen={(i) => setViewing(i.item_id)}
        rowOpenNow
        isFiltered={isFiltered}
        filteredEmpty={<EmptyState compact title={filters.q ? `No items match “${filters.q}”` : 'No items match these filters'} />}
        empty={
          <EmptyState
            compact
            title={active ? 'No item written yet' : 'No item in this attempt'}
            body={
              active
                ? 'Items appear here as the job writes them.'
                : job?.output_dataset
                  ? 'The attempt wrote no reviewable item (a job run before the review existed shows its counts only).'
                  : undefined
            }
          />
        }
        rowProps={(i) => ({ 'data-review': i.review, 'data-layer': String(i.layer) })}
      />
      {list.data && list.data.total > PAGE_SIZE ? (
        <Pagination total={list.data.total} page={page} pageSize={PAGE_SIZE} noun="item" onPageChange={setPage} />
      ) : null}
      <GeneratedItemDialog
        slug={slug}
        dataset={dataset}
        version={version}
        item={viewingItem}
        onClose={() => setViewing(null)}
        position={viewingItem ? { index: viewingIndex, total: items.length } : undefined}
        onNavigate={(delta) => {
          const next = items[viewingIndex + delta];
          if (next) setViewing(next.item_id);
        }}
        canReview={canApprove}
        busy={Boolean(viewingItem && acting === viewingItem.item_id)}
        onReview={(item, state) => void reviewOne(item, state)}
      />
      <ConfirmDialog
        open={approvingAll}
        onOpenChange={setApprovingAll}
        title={`Approve every pending item of this attempt?`}
        description={
          counts
            ? `${n(counts.pending)} pending item${counts.pending === 1 ? '' : 's'} become${counts.pending === 1 ? 's' : ''} approved. Rejected items stay rejected.`
            : undefined
        }
        confirmLabel="Approve all"
        tone="accent"
        onConfirm={async () => {
          try {
            const result = await reviewItems.mutateAsync({ review: 'approved', all_pending: true });
            toast.show(`${n(result.changed)} item${result.changed === 1 ? '' : 's'} approved`, { tone: 'success' });
          } catch (e) {
            toast.show(actionErrorMessage('approve the items', e), { tone: 'error' });
          }
        }}
      />
      {dataset && !dataset.deleted && list.data && !list.data.dataset_draft && canApprove ? (
        <Tag tone="warning">The dataset is published: a review no longer changes its items</Tag>
      ) : null}
    </div>
  );
}
