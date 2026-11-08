import { useState } from 'react';
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
import { humanizeKey } from '@/lib/humanizeKey';
import {
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
import { WorkerBlock } from './WorkerBlock';
import styles from '../../worker.module.css';

const componentLabels: Record<string, string> = {
  control: 'Settings',
  judge: 'Judges',
  dataiku: 'Dataiku',
  qym_push: 'Delivery to qym',
  turn: 'Turns',
  job: 'Jobs',
};

/** A worker component key as its label; an unknown key reads as plain words (X18). */
export function componentLabel(key: string): string {
  return componentLabels[key] ?? humanizeKey(key);
}
const checkSections: Record<string, { id: string; title: string }> = {
  gateway: { id: 'models', title: 'Models' },
  database: { id: 'database', title: 'Database' },
  langfuse: { id: 'langfuse', title: 'Langfuse' },
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

export interface ProblemsProps {
  source: string;
  status?: LiveSourceInfo;
  read: LiveWorkerRead;
  events: LiveWorkerEvent[];
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
    onEventsFilters({ ...eventsFilters, component: keys.size === 1 ? String([...keys][0]) : undefined });
  }
  function onLevels(keys: Set<Key>) {
    setLevelKeys(keys);
    onEventsFilters({
      ...eventsFilters,
      level: keys.size === 1 ? (String([...keys][0]) as 'error' | 'warning') : undefined,
    });
  }
  const components = [
    ...new Set([
      ...Object.keys(componentLabels),
      ...events.map((event) => event.component),
      ...[...componentKeys].map(String),
    ]),
  ];
  const rows = events
    .filter(
      (event) =>
        (componentKeys.size === 0 || componentKeys.has(event.component)) &&
        (levelKeys.size === 0 || levelKeys.has(event.level)),
    )
    .sort((a, b) => b.last_at.localeCompare(a.last_at));
  const sourceStatus = status ?? read.status;
  const worker = sourceStatus.worker;
  const workerVersion = typeof worker?.worker_version === 'string' ? worker.worker_version : undefined;
  const evalVersion = typeof worker?.eval_code_version === 'string' ? worker.eval_code_version : undefined;
  const problemColumns: Column<LiveWorkerEvent>[] = [
    {
      id: 'time',
      header: 'Time',
      cell: (e) => (
        <time dateTime={e.last_at} title={e.last_at}>
          {formatRelative(e.last_at)}
        </time>
      ),
    },
    {
      id: 'level',
      header: 'Level',
      cell: (e) => (
        <StatusMark
          tone={e.level === 'error' ? 'danger' : 'warning'}
          shape={e.level === 'error' ? 'cross' : 'dot'}
          label={e.level === 'error' ? 'Error' : 'Warning'}
        />
      ),
    },
    {
      id: 'component',
      header: 'Component',
      cell: (e) => (
        <Text as="span" tone="secondary" dir="auto">
          {componentLabel(e.component)}
        </Text>
      ),
    },
    {
      id: 'code',
      header: 'Code',
      cell: (e) => (
        <span className={styles.number} dir="auto">
          {e.code}
        </span>
      ),
    },
    {
      id: 'message',
      header: 'Message',
      flex: true,
      minWidth: 320,
      cell: (e) => (
        <div className={styles.messageCell}>
          <Text as="p" dir="auto" className={styles.wrap}>
            {e.message.replace(/^\[LIVE\] /, '')}
          </Text>
          {e.count > 1 ? (
            <span className={styles.inline}>
              <Tag kind="count">×{e.count}</Tag>
              <Text as="span" tone="muted">
                in {Math.max(0, Math.round((Date.parse(e.last_at) - Date.parse(e.first_at)) / 60000))} min
              </Text>
            </span>
          ) : null}
          <FailedChecks event={e} path={`${location.pathname}${location.search}`} />
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
        </div>
      ),
    },
  ];
  return (
    <WorkerBlock
      name="problems"
      title="Problems"
      table
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
            onEventsFilters({ ...eventsFilters, component: undefined, level: undefined });
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
        <Skeleton reserve kind="rows" rows={6} label="Loading worker problems" />
      ) : rows.length ? (
        <DataTable<LiveWorkerEvent>
          aria-label="Worker problems"
          variant="embedded"
          density="regular"
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
