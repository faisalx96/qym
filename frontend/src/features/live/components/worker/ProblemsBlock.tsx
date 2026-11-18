import { useId, useState } from 'react';
import type { Key } from 'react-aria-components';
import { useLocation } from 'react-router-dom';
import type { LiveSourceInfo } from '@/api/live';
import {
  problemReport,
  type LiveWorkerRead,
  type LiveWorkerEvent,
  type WorkerEventsFilters,
} from '@/api/liveWorker';
import { formatRelative } from '@/lib/format';
import { textDirAttrs } from '@/lib/text';
import { workerTime } from './format';
import { humanizeKey } from '@/lib/humanizeKey';
import {
  Button,
  ClearFiltersButton,
  CopyButton,
  DataTable,
  EmptyState,
  ErrorState,
  LinkButton,
  MultiSelect,
  Skeleton,
  StatusMark,
  Tag,
  Text,
  type Column,
} from '@/ui';
import { WorkerBlock, WorkerPagination } from './WorkerBlock';
import styles from '../../worker.module.css';

const componentLabels: Record<string, string> = {
  control: 'Settings',
  judge: 'Judges',
  dataiku: 'Dataiku',
  qym_push: 'Delivery to qym',
  turn: 'Turns',
  job: 'Jobs',
  poller: 'Polling',
  langfuse: 'Langfuse',
  evaluator_traces: 'Evaluator traces',
  gateway: 'Gateway',
  renderer: 'Charts',
  config: 'Worker environment',
};

/** A worker component key as its label; an unknown key reads as plain words (X18). */
export function componentLabel(key: string): string {
  return componentLabels[key] ?? humanizeKey(key);
}
const checkSections: Record<string, { id: string; title: string }> = {
  gateway: { id: 'models', title: 'Models' },
  database: { id: 'database', title: 'Database' },
  langfuse: { id: 'langfuse', title: 'Langfuse' },
  evaluator_traces: { id: 'evaluator_traces', title: 'Evaluator traces' },
  dataiku: { id: 'dataiku', title: 'Dataiku' },
};

function FailedChecks({ event, path }: { event: LiveWorkerEvent; path: string }) {
  const checks = event.details.checks;
  if (event.component !== 'control' || !checks || typeof checks !== 'object' || Array.isArray(checks))
    return null;
  const entries = Object.entries(checks);
  if (!entries.length) return null;
  const failed = entries.filter(
    ([, check]) => !(check && typeof check === 'object' && 'ok' in check && check.ok === true),
  );
  if (!failed.length) return null;
  const section = Object.entries(checkSections).find(([prefix]) =>
    failed[0]![0].startsWith(`${prefix}.`),
  )?.[1];
  return (
    <div className={styles.inline}>
      <Text as="span" tone="danger" className={styles.wrap} dir="auto">
        {failed.map(([name]) => name).join(' · ')}
      </Text>
      {section ? (
        <LinkButton to={`${path}#settings-${section.id}`} variant="neutral">
          Fix in {section.title}
        </LinkButton>
      ) : null}
    </div>
  );
}

export const PROBLEMS_PAGE_SIZE = 5;

export interface ProblemsProps {
  source: string;
  status?: LiveSourceInfo;
  read: LiveWorkerRead;
  events: LiveWorkerEvent[];
  eventsTotal?: number;
  eventsFilters: WorkerEventsFilters;
  onEventsFilters: (filters: WorkerEventsFilters) => void;
  eventsPending?: boolean;
  eventsError?: unknown;
  onEventsRetry?: () => void;
}
export function ProblemsBlock({
  source,
  status,
  read,
  events,
  eventsTotal,
  eventsFilters,
  onEventsFilters,
  eventsPending,
  eventsError,
  onEventsRetry,
}: ProblemsProps) {
  const location = useLocation();
  const [componentKeys, setComponentKeys] = useState<Set<Key>>(new Set());
  const [levelKeys, setLevelKeys] = useState<Set<Key>>(new Set());
  function onComponents(keys: Set<Key>) {
    setComponentKeys(keys);
    onEventsFilters({
      ...eventsFilters,
      page: 1,
      component: keys.size ? [...keys].map(String) : undefined,
    });
  }
  function onLevels(keys: Set<Key>) {
    setLevelKeys(keys);
    onEventsFilters({
      ...eventsFilters,
      page: 1,
      level: keys.size ? ([...keys].map(String) as ('error' | 'warning')[]) : undefined,
    });
  }
  const components = [
    ...new Set([
      ...Object.keys(componentLabels),
      ...events.map((event) => event.component),
      ...[...componentKeys].map(String),
    ]),
  ];
  const rows = [...events].sort((a, b) => b.last_at.localeCompare(a.last_at)).slice(0, PROBLEMS_PAGE_SIZE);
  const sourceStatus = status ?? read.status;
  const worker = sourceStatus.worker;
  const workerVersion = typeof worker?.worker_version === 'string' ? worker.worker_version : undefined;
  const evalVersion = typeof worker?.eval_code_version === 'string' ? worker.eval_code_version : undefined;
  const problemColumns: Column<LiveWorkerEvent>[] = [
    {
      id: 'time',
      header: 'Time',
      width: 140,
      priority: 2,
      cell: (e) => (
        <div className={styles.wrap}>
          <time dateTime={e.last_at} title={e.last_at}>
            {workerTime(e.last_at)}
          </time>
          <Text as="div" variant="sm" tone="muted">
            {formatRelative(e.last_at)}
          </Text>
        </div>
      ),
    },
    {
      id: 'level',
      header: 'Level',
      width: 100,
      priority: 2,
      cell: (e) => (
        <StatusMark
          tone={e.level === 'error' ? 'danger' : 'warning'}
          shape={e.level === 'error' ? 'cross' : 'full'}
          label={e.level === 'error' ? 'Error' : 'Warning'}
        />
      ),
    },
    {
      id: 'component',
      header: 'Where',
      width: 140,
      priority: 2,
      cell: (e) => (
        <Text
          as="div"
          tone="secondary"
          className={styles.wrap}
          {...textDirAttrs(componentLabel(e.component))}
        >
          {componentLabel(e.component)}
        </Text>
      ),
    },
    {
      id: 'message',
      header: 'What happened',
      priority: 1,
      flex: true,
      minWidth: 320,
      cell: (e) => (
        <div className={styles.messageCell}>
          <Text as="p" tone="primary" {...textDirAttrs(e.message)} className={styles.wrap}>
            {e.message.replace(/^\[LIVE\] /, '')}
          </Text>
          <ProblemDetails code={e.code} details={e.details} />
          <FailedChecks event={e} path={`${location.pathname}${location.search}`} />
        </div>
      ),
    },
    {
      id: 'frequency',
      header: 'How often',
      width: 120,
      align: 'end',
      priority: 2,
      cell: (e) =>
        e.count > 1 ? (
          <div>
            <Text tone="primary">{e.count} times</Text>
            <Text as="div" variant="sm" tone="muted">
              in {Math.max(0, Math.round((Date.parse(e.last_at) - Date.parse(e.first_at)) / 60000))} min
            </Text>
          </div>
        ) : (
          <Text variant="sm" tone="muted">
            once
          </Text>
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      hideLabel: true,
      width: 48,
      priority: 2,
      cell: (e) => (
        <CopyButton
          label="Copy report"
          text={() =>
            problemReport({
              source,
              environment: sourceStatus.environment,
              worker_version: workerVersion,
              eval_code_version: evalVersion,
              settings_version_applied: read.running?.settings_version_applied,
              event: e,
            })
          }
        />
      ),
    },
  ];
  return (
    <WorkerBlock
      name="problems"
      title="Problems"
      table
      footer={
        !eventsError && !eventsPending && eventsTotal !== undefined ? (
          <WorkerPagination
            total={eventsTotal}
            page={eventsFilters.page ?? 1}
            pageSize={PROBLEMS_PAGE_SIZE}
            noun="problems"
            onPageChange={(page) => onEventsFilters({ ...eventsFilters, page })}
          />
        ) : undefined
      }
      count={
        read.running?.errors_last_hour ? (
          <Tag kind="count" tone="danger">
            {read.running.errors_last_hour} in the last hour
          </Tag>
        ) : undefined
      }
    >
      <div className={styles.problemsFilters}>
        <MultiSelect
          label="Component"
          triggerVariant="bar"
          emptyMeansAll
          items={components.map((c) => ({ key: c, label: componentLabel(c) }))}
          value={componentKeys}
          onChange={onComponents}
        />
        <MultiSelect
          label="Level"
          triggerVariant="bar"
          emptyMeansAll
          items={[
            { key: 'error', label: 'Errors' },
            { key: 'warning', label: 'Warnings' },
          ]}
          value={levelKeys}
          onChange={onLevels}
        />
        <ClearFiltersButton
          count={(componentKeys.size ? 1 : 0) + (levelKeys.size ? 1 : 0)}
          onClear={() => {
            setComponentKeys(new Set());
            setLevelKeys(new Set());
            onEventsFilters({ ...eventsFilters, component: undefined, level: undefined, page: 1 });
          }}
        />
      </div>
      {eventsError ? (
        <ErrorState
          compact
          error={eventsError}
          title="Couldn’t load worker problems"
          onRetry={onEventsRetry}
        />
      ) : eventsPending ? (
        <Skeleton reserve kind="rows" rows={PROBLEMS_PAGE_SIZE} label="Loading worker problems" />
      ) : rows.length ? (
        <DataTable<LiveWorkerEvent>
          aria-label="Worker problems"
          variant="embedded"
          density="regular"
          verticalAlign="top"
          fit="declared"
          rows={rows}
          rowKey={(e) => e.id}
          rowProps={(e) => ({ 'data-worker-event': String(e.id) })}
          responsive="cards"
          columns={problemColumns}
        />
      ) : (
        <EmptyState title="No problems reported by the worker" />
      )}
    </WorkerBlock>
  );
}

/** Short details share the code line; only long values need a disclosure. Every value retains its key. */
function ProblemDetails({ code, details }: { code: string; details: LiveWorkerEvent['details'] }) {
  const entries = Object.entries(details).map(([key, value]) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return { key, text, long: text.length > 160 || text.split('\n').length > 2 };
  });
  const summary = [
    code,
    ...entries
      .filter((entry) => !entry.long)
      .map(({ key, text }) => `${key}: ${text.replace(/\s*\n\s*/g, ' ')}`),
  ].join(' · ');
  return (
    <>
      <Text as="div" variant="sm" tone="muted" mono {...textDirAttrs(summary)}>
        {summary}
      </Text>
      {entries
        .filter((entry) => entry.long)
        .map(({ key, text }) => (
          <RawDetail key={key} name={key} text={text} />
        ))}
    </>
  );
}

/** Keep long raw text intact for copy and expansion, including unknown worker detail keys. */
function RawDetail({ name, text }: { name: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const raw = `${name}: ${text}`;
  return (
    <div className={styles.rawDetailBlock}>
      <div
        id={id}
        className={styles.rawDetail}
        data-collapsed={!expanded ? '' : undefined}
        {...textDirAttrs(text)}
      >
        {raw}
      </div>
      <Button
        variant="text"
        aria-expanded={expanded}
        aria-controls={id}
        onPress={() => setExpanded(!expanded)}
      >
        {expanded ? 'Show less' : 'Show full error'}
      </Button>
    </div>
  );
}
