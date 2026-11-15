import { Fragment } from 'react';
import type { EvalEnvironment } from '@/api/evalCommon';
import { useEnvTasks, useEnvVersioning } from '@/api/launch';
import { Button, Tag } from '@/ui';
import { useLaunch } from '../LaunchContext';
import styles from './entry.module.css';

/** A value's source text: strings as is, numbers and booleans as text, objects and arrays as compact JSON. */
export function versionValueText(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** A value longer than this (or any object / array) takes the whole row of the grid. */
const WIDE = 16;
/** Placeholder cells of the loading frame (one row at every box width, round 10 L1). */
const PLACEHOLDERS = 3;

function isWide(value: unknown): boolean {
  return (value !== null && typeof value === 'object') || versionValueText(value).length > WIDE;
}

/** One value: a string in a version Tag; a number or boolean as mono text; an object or array as compact mono JSON. */
function VersionValue({ value }: { value: unknown }) {
  if (typeof value === 'string')
    return (
      <Tag kind="version" data-part="version-value">
        {value}
      </Tag>
    );
  const text = versionValueText(value);
  return (
    <span
      className={styles.vText}
      data-part="version-value"
      data-kind={value !== null && typeof value === 'object' ? 'json' : 'scalar'}
    >
      {text}
    </span>
  );
}

/** A key exactly as the service names it, with a soft break after `_`, `-` and `.` (never truncated). */
function KeyName({ name }: { name: string }) {
  const parts = name.split(/(?<=[_.-])/);
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i ? <wbr /> : null}
          {p}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The versioning details as the service reports them (round 10, point 3): every key in the response's order, the key as
 * written above its value; a key the service does not report is not drawn; no fixed key list. The grid takes the height
 * of its keys (L1). Loading: three placeholder cells on one row.
 */
export function VersionsGrid({
  details,
  loading = false,
}: {
  details?: Record<string, unknown> | null;
  loading?: boolean;
}) {
  if (loading)
    return (
      <div className={styles.vLoading} aria-busy="true">
        {Array.from({ length: PLACEHOLDERS }, (_, i) => (
          <div key={i} className={styles.vItem} aria-hidden="true" data-part="version-placeholder">
            <span className={styles.vKey}>
              <span className={styles.skelKey}>&nbsp;</span>
            </span>
            <span className={styles.skelValue} />
          </div>
        ))}
      </div>
    );
  // a key the service does not report (absent or null) is not drawn
  const entries = Object.entries(details ?? {}).filter(([, v]) => v !== undefined && v !== null);
  if (!entries.length) return <p className={styles.vEmpty}>No versioning details reported</p>;
  return (
    <dl className={styles.vGrid}>
      {entries.map(([key, value]) => (
        <div key={key} className={styles.vItem} data-wide={isWide(value) ? '' : undefined}>
          <dt className={styles.vKey} data-part="version-key">
            <KeyName name={key} />
          </dt>
          <dd>
            <VersionValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * "Refresh" in the box's head row: reads the Evaluation Service versions again and, when the environment offers
 * tasks, its task list (the Task section's union). A request already in flight is kept: Refresh twice is harmless.
 */
export function EnvRefresh({ env, projectId }: { env: EvalEnvironment; projectId: string }) {
  const query = useEnvVersioning(projectId, env.id, true);
  const offersTasks = Boolean(env.evaluator_capabilities?.task);
  const tasksQuery = useEnvTasks(projectId, env.id, offersTasks);
  const hasTasks = offersTasks && tasksQuery.data?.status !== 'unsupported';
  return (
    <Button
      variant="neutral"
      size="sm"
      aria-label={hasTasks ? `Refresh versions and tasks of ${env.name}` : `Refresh versions of ${env.name}`}
      onPress={() => {
        void query.refetch({ cancelRefetch: false });
        if (offersTasks) void tasksQuery.refetch({ cancelRefetch: false });
      }}
    >
      Refresh
    </Button>
  );
}

/**
 * The Evaluation Service versions a run started now would record, shown inside the environment's own box (home view and
 * Customize step 1 share the picker) for a ticked environment only: the "Versions" label on its own line, then the grid.
 * One react-query entry per environment, read when the box is first ticked and again on its Refresh. Read only.
 */
export function EnvVersions({ env, projectId }: { env: EvalEnvironment; projectId: string }) {
  const query = useEnvVersioning(projectId, env.id, true);
  const data = query.data;
  const status = query.isPending || query.isFetching ? 'loading' : query.isError ? 'error' : data?.status;
  return (
    <div className={styles.versions} data-part="env-versions" data-env-version={env.id} data-status={status}>
      <span className={styles.versionLabel}>Versions</span>
      {status === 'loading' ? (
        <>
          <span className={styles.srOnly} role="status">
            Reading…
          </span>
          <VersionsGrid loading />
        </>
      ) : status === 'unsupported' ? (
        <p className={styles.vEmpty}>
          Not supported by this environment (its Evaluation Service is older than v1.2).
        </p>
      ) : status === 'ok' ? (
        <VersionsGrid details={data?.versioning_details} />
      ) : (
        <p className={styles.vError}>
          Couldn’t read:{' '}
          {data?.error || (query.error instanceof Error ? query.error.message : 'unknown error')}
        </p>
      )}
    </div>
  );
}

function SummaryEnv({ env, projectId, many }: { env: EvalEnvironment; projectId: string; many: boolean }) {
  const query = useEnvVersioning(projectId, env.id, true);
  const data = query.data;
  const loading = query.isPending;
  const body = loading ? (
    <VersionsGrid loading />
  ) : data?.status === 'ok' ? (
    <VersionsGrid details={data.versioning_details} />
  ) : (
    <p className={styles.vEmpty}>
      {data?.status === 'unsupported' ? 'Not supported by this environment' : '—'}
    </p>
  );
  return (
    <div className={many ? styles.reviewEnv : undefined} data-part="review-versions-env" data-env={env.name}>
      {many ? <span className={styles.reviewEnvName}>{env.name}</span> : null}
      {body}
    </div>
  );
}

/** The review's "Versions" row: per ticked environment the same grid, with the environment's name when there are several. */
export function VersionsSummary() {
  const { selectedEnvs, projectId } = useLaunch();
  return (
    <div className={styles.reviewVersions} data-part="review-versions">
      {selectedEnvs.map((env) => (
        <SummaryEnv key={env.id} env={env} projectId={projectId} many={selectedEnvs.length > 1} />
      ))}
    </div>
  );
}
