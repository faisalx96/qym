/**
 * /projects/:slug/experiments (brief 06 §2.1): filters in the URL, one table, live refresh.
 * `?status=&mine=1&versioning=key=value` (repeatable) and `page`.
 */
import { useMemo } from 'react';
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
import { useDelayedPending } from '@/lib/pending';
import {
  Checkbox,
  DataTable,
  EmptyState,
  Icon,
  LinkButton,
  PageHeader,
  ProgressCell,
  RelativeTime,
  Select,
  Tag,
  Text,
  TwoLine,
  UserCell,
  type Column,
} from '@/ui';
import { ExperimentsTabs } from '../ExperimentsTabs';
import { LatencyTag } from '../components/LatencyTag';
import { ExperimentStatusBadge } from '../components/StatusBadges';
import { baseSourceLabel, plural, tallyJobCounts, versioningLabel, versioningWords } from '../lib/format';
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

  const envById = useMemo(() => new Map((envs.data ?? []).map((e) => [e.id, e])), [envs.data]);
  const experiments = query.data?.experiments ?? [];
  const total = query.data?.total ?? 0;
  const live = experiments.some((x) => LIVE_EXPERIMENT_STATUSES.includes(x.status));
  const facets = query.data?.versioning_facets ?? {};
  // A key already in the URL keeps its select even when no experiment reports it any more.
  const versioningKeys = [...new Set([...Object.keys(facets), ...Object.keys(versioning)])].sort((a, b) =>
    a.localeCompare(b),
  );
  const filtered = Boolean(status || mine || latency || Object.keys(versioning).length);

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
      id: 'progress',
      header: 'Progress',
      width: 150,
      priority: 2,
      cell: (x) => {
        const t = tallyJobCounts(x.job_counts);
        return (
          <ProgressCell done={t.ok + t.failed + t.cancelled} total={t.ok + t.failed + t.cancelled + t.live} />
        );
      },
    },
    {
      id: 'environments',
      header: 'Environments',
      width: 200,
      priority: 2,
      cell: (x) => <EnvironmentNames ids={x.environment_ids} envById={envById} />,
    },
    { id: 'base', header: 'Base', width: 130, priority: 3, cell: (x) => baseSourceLabel(x.base_source) },
    { id: 'jobs', header: 'Jobs', width: 190, priority: 3, cell: (x) => <JobTags counts={x.job_counts} /> },
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

  const launch = readOnly ? undefined : (
    <LinkButton to={launchPath(slug)} variant="primary" size="md" icon={<Icon name="plus" size={12} />}>
      New experiment
    </LinkButton>
  );

  const emptyAll = Boolean(query.data) && !filtered && total === 0;
  const filters = (
    <div className={styles.filters} role="group" aria-label="Filter experiments">
      <Select
        label="Status"
        items={[
          { key: ALL, label: 'All statuses' },
          ...EXPERIMENT_STATUSES.map((s) => ({ key: s, label: s.toLowerCase() })),
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
        width={150}
      />
      {versioningKeys.map((key) => {
        const selected = versioning[key];
        const values = facets[key] ?? [];
        const options = selected !== undefined && !values.includes(selected) ? [selected, ...values] : values;
        return (
          <span key={key} title={`Evaluation Service versioning: ${key}`} data-exp-versioning={key}>
            <Select
              label={versioningLabel(key)}
              items={[
                { key: ALL, label: `All ${versioningWords(key)}s` },
                ...options.map((v) => ({ key: v, label: v })),
              ]}
              value={selected ?? ALL}
              onChange={(k) => setVersioning(key, !k || k === ALL ? null : String(k))}
              width={170}
            />
          </span>
        );
      })}
      <Checkbox
        isSelected={mine}
        onChange={(on) =>
          update((next) => {
            if (on) next.set('mine', '1');
            else next.delete('mine');
            resetPage(next);
          })
        }
      >
        Created by me
      </Checkbox>
      <Checkbox
        isSelected={latency}
        onChange={(on) =>
          update((next) => {
            if (on) next.set('latency', '1');
            else next.delete('latency');
            resetPage(next);
          })
        }
      >
        Latency-sensitive only
      </Checkbox>
    </div>
  );

  return (
    <div className={fullWidth} data-experiments-list>
      <PageHeader
        title="Experiments"
        description="Launch one evaluation across settings and environments, then compare the runs."
        meta={query.data ? [plural(total, 'experiment')] : undefined}
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
            {
              id: 'open',
              label: 'Open',
              icon: 'external',
              primary: true,
              onPress: () => navigate(experimentPath(slug, x.id)),
            },
            ...(readOnly
              ? []
              : [
                  {
                    id: 'duplicate',
                    label: 'Duplicate',
                    onPress: () => navigate(launchPath(slug, { clone: x.id })),
                  },
                ]),
          ]}
          rowState={(x) => (LIVE_EXPERIMENT_STATUSES.includes(x.status) ? 'live' : undefined)}
          minWidth={1000}
          density="regular"
          loading={showSkeleton}
          refreshing={query.isFetching && !showSkeleton && live}
          error={query.isError && !query.data ? query.error : undefined}
          onRetry={() => void query.refetch()}
          isFiltered={filtered}
          empty={
            emptyAll ? (
              <EmptyState
                icon={<Icon name="flask" />}
                title="No experiments yet"
                body="An experiment launches the same evaluation across settings and environments so you can compare the results."
                action={launch}
              />
            ) : undefined
          }
          filteredEmpty={
            <EmptyState
              compact
              title="No matching experiments"
              body="Nothing matches these filters."
              action={
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setParams({}, { replace: true })}
                >
                  Clear filters
                </button>
              }
            />
          }
        >
          <DataTable.Toolbar
            filters={filters}
            trailing={
              live ? (
                <Text variant="sm" tone="muted">
                  Refreshes automatically while experiments run
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

function JobTags({ counts }: { counts: Experiment['job_counts'] }) {
  const t = tallyJobCounts(counts);
  return (
    <span className={styles.tags}>
      <Tag kind="count" tone="success" title={`${t.ok} succeeded`}>
        ✓ {t.ok}
      </Tag>
      <Tag kind="count" tone="danger" title={`${t.failed} failed or timed out`}>
        ✗ {t.failed}
      </Tag>
      {t.live ? (
        <Tag kind="count" tone="info" title={`${t.live} queued or running`}>
          ● {t.live}
        </Tag>
      ) : null}
      {t.cancelled ? (
        <Tag kind="count" tone="warning" title={`${t.cancelled} cancelled`}>
          ⊘ {t.cancelled}
        </Tag>
      ) : null}
    </span>
  );
}
