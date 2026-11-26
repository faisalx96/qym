import { useState } from 'react';
import type { Key } from 'react-aria-components';
import {
  usePlatformDashboards,
  usePlatformSteps,
  platformStepsCsvUrl,
  downloadPerformanceFile,
  platformCanonicalId,
  type PlatformDashboardRow,
  type PlatformId,
  type PlatformStepFilters,
  type PlatformStepRow,
} from '@/api/performancePlatform';
import {
  Button,
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  Icon,
  InlineNotice,
  MultiSelect,
  Pagination,
  SearchField,
  Select,
  type Column,
} from '@/ui';
import { clock, count, secs } from '../../lib/format';
import { platformCount, REASON_WORDS } from './words';
import styles from './platform.module.css';

const errorCount = (errors: PlatformDashboardRow['errors_by_class']) =>
  Object.values(errors).reduce((sum, value) => sum + value, 0);
const columns: Column<PlatformDashboardRow>[] = [
  {
    id: 'title',
    header: 'Dashboard',
    primary: true,
    cell: (r) => (
      <div className={styles.title}>
        <span dir="auto">{r.title || String(r.dashboard_id)}</span>
      </div>
    ),
  },
  { id: 'opens', header: 'Opens', type: 'number', accessor: (r) => r.opens },
  {
    id: 'p50',
    header: 'Open p50',
    headerCase: 'as-written',
    type: 'number',
    cell: (r) => secs(r.open_p50_ms),
  },
  {
    id: 'p95',
    header: 'Open p95',
    headerCase: 'as-written',
    type: 'number',
    cell: (r) => secs(r.open_p95_ms),
  },
  {
    id: 'filter',
    header: 'Filter p95',
    headerCase: 'as-written',
    type: 'number',
    cell: (r) => secs(r.filter_p95_ms),
  },
  {
    id: 'errors',
    header: 'Errors',
    type: 'number',
    cell: (r) => count(errorCount(r.errors_by_class)),
    hint: 'Recorded errors, not an error percentage.',
  },
  { id: 'missing', header: 'Charts not loaded', type: 'number', accessor: (r) => r.charts_unusable },
];
const STEP_NAMES = { open: 'Dashboard open', filter: 'Filter change', error: 'Failed request' };
const stepColumns: Column<PlatformStepRow>[] = [
  { id: 'at', header: 'Time', type: 'date', cell: (r) => clock(r.at) },
  { id: 'type', header: 'Step', cell: (r) => STEP_NAMES[r.type] },
  { id: 'duration', header: 'Time taken', type: 'number', cell: (r) => secs(r.duration_ms) },
  { id: 'level', header: 'Users', type: 'number', cell: (r) => r.level ?? '–' },
  { id: 'user', header: 'User', type: 'number', accessor: (r) => r.user_number },
  {
    id: 'detail',
    header: 'Detail',
    wrap: true,
    cell: (r) =>
      r.type === 'error'
        ? `${REASON_WORDS[r.error_class ?? ''] ?? 'Request failed'}${r.http_status ? ` ${r.http_status}` : ''}`
        : r.type === 'filter'
          ? `Control: ${typeof r.control === 'object' ? JSON.stringify(r.control) : (r.control ?? '–')}`
          : `${count(r.charts_ok)} of ${platformCount(r.charts ?? 0, 'chart')} loaded`,
  },
];
export function PlatformSteps({
  slug,
  runId,
  dashboard,
  active,
}: {
  slug: string;
  runId: string;
  dashboard: PlatformId;
  active: boolean;
}) {
  const [page, setPage] = useState(1);
  const [types, setTypes] = useState<Set<Key>>(new Set());
  const [levels, setLevels] = useState<Set<Key>>(new Set());
  const [errors, setErrors] = useState<Set<Key>>(new Set());
  const [stages, setStages] = useState<Set<Key>>(new Set());
  const [exportError, setExportError] = useState(false);
  const filters: PlatformStepFilters = {
    dashboard: [dashboard],
    page,
    page_size: 25,
    sort: 'seq',
    type: [...types] as PlatformStepRow['type'][],
    level: [...levels].map(Number),
    error_class: [...errors] as PlatformStepFilters['error_class'],
    stage: [...stages] as PlatformStepFilters['stage'],
  };
  const query = usePlatformSteps(slug, runId, filters, { active });
  function select(set: (keys: Set<Key>) => void, keys: Set<Key>) {
    set(keys);
    setPage(1);
  }
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <MultiSelect
          label="Step"
          triggerVariant="bar"
          emptyMeansAll
          items={Object.entries(STEP_NAMES).map(([key, label]) => ({ key, label }))}
          value={types}
          onChange={(keys) => select(setTypes, keys)}
        />
        <MultiSelect
          label="Level"
          triggerVariant="bar"
          emptyMeansAll
          items={(query.data?.facets.levels ?? []).map((n) => ({ key: String(n), label: String(n) }))}
          value={levels}
          onChange={(keys) => select(setLevels, keys)}
        />
        <MultiSelect
          label="Error"
          triggerVariant="bar"
          emptyMeansAll
          items={(query.data?.facets.error_classes ?? []).map((key) => ({
            key,
            label: REASON_WORDS[key] ?? 'Other request error',
          }))}
          value={errors}
          onChange={(keys) => select(setErrors, keys)}
        />
        <MultiSelect
          label="Stage"
          triggerVariant="bar"
          emptyMeansAll
          items={(query.data?.facets.stages ?? []).map((key) => ({
            key,
            label:
              key === 'hold'
                ? 'Measuring'
                : key === 'steady'
                  ? 'Smoke'
                  : key === 'ramp'
                    ? 'Adding users'
                    : key === 'cooldown'
                      ? 'Finishing'
                      : 'Baseline',
          }))}
          value={stages}
          onChange={(keys) => select(setStages, keys)}
        />
        <Button
          variant="accent"
          icon={<Icon name="download" size={12} />}
          onPress={() => {
            setExportError(false);
            void downloadPerformanceFile(platformStepsCsvUrl(slug, runId, filters)).catch(() =>
              setExportError(true),
            );
          }}
        >
          Download CSV
        </Button>
      </div>
      {exportError ? (
        <InlineNotice tone="danger">Couldn’t download the steps. Try again.</InlineNotice>
      ) : null}
      {query.data?.details_expired ? (
        <InlineNotice tone="neutral">
          Step details have expired. Discovery and the summary are still available.
        </InlineNotice>
      ) : null}
      {query.data?.counts.dropped ? (
        <InlineNotice tone="warning">
          {count(query.data.counts.dropped)} step records could not be stored.
        </InlineNotice>
      ) : null}
      <DataTable
        aria-label="Dashboard steps"
        variant="embedded"
        rows={query.data?.rows ?? []}
        columns={stepColumns}
        rowKey={(r) => r.seq}
        loading={query.isPending}
        error={query.error}
        errorTitle="Couldn’t load the steps"
        onRetry={() => void query.refetch()}
        responsive="scroll"
        empty={<EmptyState compact title="No matching steps" />}
      />
      <Pagination
        total={query.data?.total ?? 0}
        page={page}
        pageSize={25}
        onPageChange={setPage}
        noun="steps"
      />
    </div>
  );
}
export function PlatformDashboards({
  slug,
  runId,
  active,
}: {
  slug: string;
  runId: string;
  active: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<'title' | '-open_p95_ms'>('title');
  const [expanded, setExpanded] = useState<Set<Key>>(new Set());
  const query = usePlatformDashboards(slug, runId, { q: search, page, page_size: 25, sort }, { active });
  return (
    <Card
      flush
      header={
        <CardTitle
          title="Dashboards"
          description="Dashboard open time includes its usable charts. Errors count failed requests. Expand a row for its steps."
        />
      }
    >
      <DataTable
        aria-label="Dashboards"
        variant="embedded"
        stripe="report"
        rows={query.data?.rows ?? []}
        columns={columns}
        rowKey={(r) => platformCanonicalId(r.dashboard_id)}
        expanded={expanded}
        onExpandedChange={setExpanded}
        renderExpanded={(r) => (
          <PlatformSteps slug={slug} runId={runId} dashboard={r.dashboard_id} active={active} />
        )}
        expandOnRowClick
        loading={query.isPending}
        error={query.error}
        errorTitle="Couldn’t load the dashboards"
        onRetry={() => void query.refetch()}
        responsive="scroll"
        empty={
          <EmptyState
            compact
            title={search ? `No dashboards match “${search}”` : 'No dashboards yet'}
            body={search ? undefined : 'The list arrives after discovery.'}
          />
        }
      >
        <DataTable.Toolbar
          filters={
            <div className={styles.row}>
              <SearchField
                label="Find a dashboard"
                placeholder="Search by title"
                shortcut="/"
                width="var(--search-width)"
                value={search}
                onChange={(value) => {
                  setSearch(value);
                  setPage(1);
                }}
              />
              <Select
                label="Sort"
                triggerVariant="bar"
                showValue="always"
                value={sort}
                onChange={(key) => {
                  setSort(key as typeof sort);
                  setPage(1);
                }}
                items={[
                  { key: 'title', label: 'Title' },
                  { key: '-open_p95_ms', label: 'Slowest open p95' },
                ]}
              />
            </div>
          }
        />
        <DataTable.Footer
          pagination={{
            total: query.data?.total ?? 0,
            page,
            pageSize: 25,
            onPageChange: setPage,
            noun: platformCount(query.data?.total ?? 0, 'dashboard', true),
          }}
        />
      </DataTable>
      {query.data && !query.data.records_complete ? (
        <InlineNotice tone="warning">
          Some measurements are missing. These counts cover the records available.
        </InlineNotice>
      ) : null}
    </Card>
  );
}
