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
import { Chip, CopyButton, EmptyState, ErrorState, LinkButton, Skeleton, Tag, Text } from '@/ui';
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
        <LinkButton to={`${path}#settings-${section.id}`} variant="ghost">
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
  const components = [
    ...new Set([
      ...Object.keys(componentLabels),
      ...events.map((event) => event.component),
      ...(eventsFilters.component ? [eventsFilters.component] : []),
    ]),
  ];
  const rows = events
    .filter(
      (event) =>
        (!eventsFilters.component || eventsFilters.component === event.component) &&
        (!eventsFilters.level || eventsFilters.level === event.level),
    )
    .sort((a, b) => b.last_at.localeCompare(a.last_at));
  const sourceStatus = status ?? read.status;
  const worker = sourceStatus.worker;
  const workerVersion = typeof worker?.worker_version === 'string' ? worker.worker_version : undefined;
  const evalVersion = typeof worker?.eval_code_version === 'string' ? worker.eval_code_version : undefined;
  return (
    <WorkerBlock
      name="problems"
      title="Problems"
      aside={
        read.running?.errors_last_hour ? (
          <Text tone="danger">{read.running.errors_last_hour} in the last hour</Text>
        ) : undefined
      }
    >
      <div className={styles.inline}>
        <Chip
          isSelected={!eventsFilters.component}
          onChange={() => onEventsFilters({ ...eventsFilters, component: undefined })}
        >
          All
        </Chip>
        {components.map((component) => (
          <Chip
            key={component}
            isSelected={eventsFilters.component === component}
            onChange={(selected) =>
              onEventsFilters({ ...eventsFilters, component: selected ? component : undefined })
            }
          >
            {componentLabels[component] ?? component}
          </Chip>
        ))}
        {(['error', 'warning'] as const).map((level) => (
          <Chip
            key={level}
            isSelected={eventsFilters.level === level}
            onChange={(selected) =>
              onEventsFilters({ ...eventsFilters, level: selected ? level : undefined })
            }
          >
            {level === 'error' ? 'Errors' : 'Warnings'}
          </Chip>
        ))}
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
        <ul className={styles.problems}>
          {rows.map((event) => (
            <li key={event.id} className={styles.problem} data-worker-event={event.id}>
              <div className={styles.inline}>
                <time dateTime={event.last_at} title={event.last_at}>
                  {formatRelative(event.last_at)}
                </time>
                <Tag tone={event.level === 'error' ? 'danger' : 'warning'} dir="auto">
                  {event.component}
                </Tag>
                <span className={styles.number} dir="auto">
                  {event.code}
                </span>
                {event.count > 1 ? (
                  <span>
                    × {event.count}{' '}
                    <Text as="span" tone="muted">
                      in{' '}
                      {Math.max(
                        0,
                        Math.round((Date.parse(event.last_at) - Date.parse(event.first_at)) / 60000),
                      )}{' '}
                      min
                    </Text>
                  </span>
                ) : null}
                <CopyButton
                  label="Copy report"
                  text={() =>
                    problemReport({
                      source,
                      environment: sourceStatus.environment,
                      worker_version: workerVersion,
                      eval_code_version: evalVersion,
                      settings_version_applied: read.running?.settings_version_applied,
                      event,
                    })
                  }
                />
              </div>
              <Text as="p" dir="auto" className={styles.wrap}>
                {event.message.replace(/^\[LIVE\] /, '')}
              </Text>
              <FailedChecks event={event} path={`${location.pathname}${location.search}`} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No problems reported by the worker" />
      )}
    </WorkerBlock>
  );
}
