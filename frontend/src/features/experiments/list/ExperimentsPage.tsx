/**
 * /projects/:slug/experiments (brief 06 §2.1): filters in the URL, one table, live refresh.
 * `?status=&mine=1&versioning=key=value` (repeatable) and `page`.
 */
import { useMemo, useState } from 'react';
import { useHref, useNavigate, useSearchParams } from 'react-router-dom';
import { RouterProvider } from 'react-aria-components';
import {
  useExperiments,
  type Experiment,
  EXPERIMENT_STATUSES,
  LIVE_EXPERIMENT_STATUSES,
} from '@/api/experiments';
import { useEvalEnvironments, type EvalEnvironment } from '@/api/evalCommon';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { tableLoading, useDelayedPending } from '@/lib/pending';
import {
  ClearFiltersButton,
  DataTable,
  EmptyState,
  Icon,
  LinkButton,
  PageHeader,
  RelativeTime,
  Select,
  Text,
  TwoLine,
  UserCell,
  type Column,
  SearchField,
} from '@/ui';
import { LATENCY_FILTER_LABEL } from '../copy';
import { ExperimentsTabs } from '../ExperimentsTabs';
import { ConnectFirst } from '../components/ConnectFirst';
import { LatencyTag } from '../components/LatencyTag';
import { ExperimentStatusBadge } from '../components/StatusBadges';
import { baseSourceLabel, jobsText, plural, tallyJobCounts, titleCase, versioningLabel } from '../lib/format';
import { loadLaunchPage } from '../lazy';
import { experimentPath, launchPath } from '../paths';
import styles from './ExperimentsPage.module.css';

const PAGE_SIZE = 50;
const ALL = '__all';

/** `versioning=key=value` params -> {key: value} (first `=` splits). */
export function parseVersioning(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of params.getAll('versioning')) {
    const at = entry.indexOf('=');
    if (at > 0) out[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return out;
}

export function ExperimentsPage() {
  const { project, slug, readOnly } = useProjectContext();
  useDocumentTitle(`${project.name} · Experiments`);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const status = params.get('status') ?? '';
  const mine = params.get('mine') === '1';
  const latency = params.get('latency') === '1';
  const versioning = useMemo(() => parseVersioning(params), [params]);
  const page = Math.max(1, Number(params.get('page')) || 1);

  const query = useExperiments(project.id, {
    status,
    mine,
    latency,
    versioning,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const envs = useEvalEnvironments(project.id);
  const showSkeleton = useDelayedPending(query.isPending);

  // C121: with no active environment the empty list offers Add environment in place, then a launch on it
  const [created, setCreated] = useState<EvalEnvironment | null>(null);
  const noActiveEnv = Boolean(envs.data) && !(envs.data ?? []).some((e) => e.is_active);
  const envById = useMemo(() => new Map((envs.data ?? []).map((e) => [e.id, e])), [envs.data]);
  const [search, setSearch] = useState('');
  const loaded = query.data?.experiments ?? [];
  // C152: the toolbar starts with a 260px search over the listed experiments
  const needle = search.trim().toLowerCase();
  const experiments = needle
    ? loaded.filter((x) => `${x.name} ${x.id} ${x.description}`.toLowerCase().includes(needle))
    : loaded;
  const total = query.data?.total ?? 0;
  const live = experiments.some((x) => LIVE_EXPERIMENT_STATUSES.includes(x.status));
  const facets = query.data?.versioning_facets ?? {};
  // A key already in the URL keeps its select even when no experiment reports it any more.
  const versioningKeys = [...new Set([...Object.keys(facets), ...Object.keys(versioning)])].sort((a, b) =>
    a.localeCompare(b),
  );
  const filtered = Boolean(status || mine || latency || needle || Object.keys(versioning).length);

  function update(mutate: (next: URLSearchParams) => void) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      },
      { replace: true },
    );
  }
  const resetPage = (next: URLSearchParams) => next.delete('page');
  function setVersioning(key: string, value: string | null) {
    update((next) => {
      const kept = next.getAll('versioning').filter((entry) => !entry.startsWith(`${key}=`));
      next.delete('versioning');
      kept.forEach((entry) => next.append('versioning', entry));
      if (value) next.append('versioning', `${key}=${value}`);
      resetPage(next);
    });
  }

  const columns: Column<Experiment>[] = [
    {
      id: 'name',
      header: 'Name',
      flex: true,
      minWidth: 220,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (x) => (
        <TwoLine
          primary={
            <span className={styles.nameLine}>
              {x.name || x.id}
              {x.latency_sensitive ? <LatencyTag /> : null}
            </span>
          }
          secondary={x.description}
        />
      ),
    },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 120,
      priority: 1,
      cell: (x) => <ExperimentStatusBadge status={x.status} />,
    },
    {
      id: 'jobs',
      header: 'Jobs',
      width: 190,
      priority: 2,
      cell: (x) => <JobsCell counts={x.job_counts} />,
    },
    {
      id: 'environments',
      header: 'Environments',
      width: 200,
      priority: 2,
      cell: (x) => <EnvironmentNames ids={x.environment_ids} envById={envById} />,
    },
    { id: 'base', header: 'Base', width: 130, priority: 3, cell: (x) => baseSourceLabel(x.base_source) },
    {
      id: 'creator',
      header: 'Created by',
      type: 'text',
      width: 180,
      priority: 3,
      cell: (x) => <UserCell name={x.created_by_email} />,
    },
    {
      id: 'age',
      header: 'Created',
      type: 'date',
      width: 120,
      priority: 2,
      cell: (x) => <RelativeTime iso={x.created_at} />,
    },
  ];

  // C081: the pointer on (or focus of) New experiment starts loading the launch form
  const prefetchLaunch = () => void loadLaunchPage();
  const launch = readOnly ? undefined : (
    <LinkButton
      to={launchPath(slug)}
      variant="primary"
      size="md"
      isDisabled={noActiveEnv}
      disabledReason="Add an environment first"
      icon={<Icon name="plus" size={12} />}
      onPointerEnter={prefetchLaunch}
      onFocus={prefetchLaunch}
    >
      New experiment
    </LinkButton>
  );

  const emptyAll = Boolean(query.data) && !filtered && total === 0;
  const searchField = (
    <SearchField
      label="Search experiments"
      placeholder="Search experiments"
      value={search}
      onChange={setSearch}
      width="var(--search-width)"
      shortcut="/"
    />
  );
  const activeCount =
    (status ? 1 : 0) + Object.keys(versioning).length + (mine ? 1 : 0) + (latency ? 1 : 0) + (needle ? 1 : 0);
  const filterRow = (
    <div className={styles.filterRow} role="group" aria-label="Filter experiments">
      <Select
        label="Status"
        triggerVariant="bar"
        items={[
          { key: ALL, label: 'All statuses' },
          ...EXPERIMENT_STATUSES.map((s) => ({ key: s, label: titleCase(s) })),
        ]}
        value={status || ALL}
        onChange={(k) =>
          update((next) => {
            if (!k || k === ALL) next.delete('status');
            else next.set('status', String(k));
            resetPage(next);
          })
        }
        searchable={false}
      />
      {versioningKeys.map((key) => {
        const selected = versioning[key];
        const values = facets[key] ?? [];
        const options = selected !== undefined && !values.includes(selected) ? [selected, ...values] : values;
        return (
          <span key={key} title={`Evaluation Service versioning: ${key}`} data-exp-versioning={key}>
            <Select
              label={versioningLabel(key)}
              triggerVariant="bar"
              items={[{ key: ALL, label: 'All values' }, ...options.map((v) => ({ key: v, label: v }))]}
              value={selected ?? ALL}
              onChange={(k) => setVersioning(key, !k || k === ALL ? null : String(k))}
            />
          </span>
        );
      })}
      <Select
        label="Created by"
        triggerVariant="bar"
        searchable={false}
        items={[
          { key: '', label: 'Everyone' },
          { key: 'me', label: 'Me' },
        ]}
        value={mine ? 'me' : ''}
        onChange={(k) =>
          update((next) => {
            if (k === 'me') next.set('mine', '1');
            else next.delete('mine');
            resetPage(next);
          })
        }
      />
      <Select
        label="Latency-sensitive"
        triggerVariant="bar"
        searchable={false}
        items={[
          { key: '', label: 'All' },
          { key: '1', label: LATENCY_FILTER_LABEL },
        ]}
        value={latency ? '1' : ''}
        onChange={(k) =>
          update((next) => {
            if (k === '1') next.set('latency', '1');
            else next.delete('latency');
            resetPage(next);
          })
        }
      />
      <ClearFiltersButton
        count={activeCount}
        onClear={() => {
          setSearch('');
          setParams({}, { replace: true });
        }}
      />
    </div>
  );

  return (
    <div className={fullWidth} data-experiments-list>
      <PageHeader
        title="Experiments"
        description="Launch one evaluation across settings and environments, then compare the runs."
        actions={launch}
        tabs={<ExperimentsTabs current="experiments" />}
      />
      <RouterProvider navigate={navigate} useHref={useHref}>
        <DataTable<Experiment>
          aria-label="Experiments"
          storageKey="experiments.list.v2"
          columns={columns}
          rows={experiments}
          rowKey={(x) => x.id}
          rowHref={(x) => experimentPath(slug, x.id)}
          rowActions={(x) => [
            ...(readOnly
              ? []
              : [
                  {
                    id: 'run-again',
                    label: 'Run again',
                    onPress: () => navigate(launchPath(slug, { clone: x.id })),
                  },
                ]),
          ]}
          rowState={(x) => (LIVE_EXPERIMENT_STATUSES.includes(x.status) ? 'live' : undefined)}
          minWidth={1000}
          density="regular"
          loading={tableLoading(query.isPending, showSkeleton)}
          refreshing={query.isFetching && !showSkeleton && live}
          error={query.isError && !query.data ? query.error : undefined}
          onRetry={() => void query.refetch()}
          isFiltered={filtered}
          empty={
            emptyAll ? (
              noActiveEnv && !created ? (
                <ConnectFirst onCreated={setCreated} />
              ) : (
                <EmptyState
                  icon={<Icon name="flask" />}
                  title="No experiments yet"
                  guide="/docs/platform-guide/projects-data-review"
                  body="An experiment launches the same evaluation across settings and environments so you can compare the results."
                  action={
                    created && !readOnly ? (
                      <LinkButton
                        to={launchPath(slug, { env: created.id })}
                        variant="primary"
                        size="md"
                        icon={<Icon name="plus" size={12} />}
                      >
                        {`New experiment on ${created.name}`}
                      </LinkButton>
                    ) : (
                      launch
                    )
                  }
                />
              )
            ) : undefined
          }
          filteredEmpty={
            <EmptyState
              compact
              title={
                needle ? `No experiments match “${search.trim()}”` : 'No experiments match these filters'
              }
            />
          }
        >
          <DataTable.Toolbar
            search={searchField}
            rows={filterRow}
            trailing={
              live ? (
                <Text variant="sm" tone="muted">
                  Updates automatically
                </Text>
              ) : null
            }
          />
          <DataTable.Footer
            summary={query.data ? plural(total, 'experiment') : undefined}
            pagination={
              query.data && total > PAGE_SIZE
                ? {
                    total,
                    page,
                    pageSize: PAGE_SIZE,
                    noun: 'experiments',
                    onPageChange: (p) =>
                      update((next) => (p > 1 ? next.set('page', String(p)) : next.delete('page'))),
                  }
                : undefined
            }
          />
        </DataTable>
      </RouterProvider>
    </div>
  );
}

function EnvironmentNames({ ids, envById }: { ids: string[]; envById: Map<string, EvalEnvironment> }) {
  if (!ids.length) return <>—</>;
  const text = ids
    .map((id) => {
      const env = envById.get(id);
      return env ? `${env.name}${env.is_active ? '' : ' (disabled)'}` : id;
    })
    .join(', ');
  return (
    <span className={styles.truncate} title={text}>
      {text}
    </span>
  );
}

/**
 * One Jobs column (C139): a bar split by outcome (succeeded green, failed red, cancelled amber, running blue; queued
 * jobs leave the track empty) and "5/6 · 1 failed". A failed experiment no longer shows a full green bar.
 */
function JobsCell({ counts }: { counts: Experiment['job_counts'] }) {
  const t = tallyJobCounts(counts);
  const total = t.ok + t.failed + t.cancelled + t.live;
  const parts = [
    { key: 'ok', n: t.ok, label: 'succeeded' },
    { key: 'failed', n: t.failed, label: 'failed or timed out' },
    { key: 'cancelled', n: t.cancelled, label: 'cancelled' },
    { key: 'running', n: t.running, label: 'running' },
  ].filter((p) => p.n > 0);
  const queued = t.live - t.running;
  const title = [...parts.map((p) => `${p.n} ${p.label}`), ...(queued ? [`${queued} queued`] : [])].join(
    ', ',
  );
  return (
    <span className={styles.jobs} title={title || 'No jobs'}>
      <span
        className={styles.jobsTrack}
        role="img"
        aria-label={title || 'No jobs'}
        data-testid="exp-jobs-bar"
      >
        {total
          ? parts.map((p) => (
              <span
                key={p.key}
                className={styles.jobsPart}
                data-part={p.key}
                style={{ inlineSize: `${(p.n / total) * 100}%` }}
              />
            ))
          : null}
      </span>
      <span className={styles.jobsText}>{jobsText(t)}</span>
    </span>
  );
}
