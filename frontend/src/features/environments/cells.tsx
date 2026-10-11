/** Shared table/section cells of the environments area. */
import type { EvalEnvironment } from '@/api/evalCommon';
import { Tag } from '@/ui';
import { absTime, relTime, shortHash } from './format';
import styles from './EnvironmentsTable.module.css';

export function HealthCell({ env, showTime = true }: { env: EvalEnvironment; showTime?: boolean }) {
  const status = env.health_status === 'ok' ? 'ok' : env.health_status === 'error' ? 'error' : 'unknown';
  const label = status === 'ok' ? 'Healthy' : status === 'error' ? 'Error' : 'Unknown';
  const checked = relTime(env.health_checked_at);
  const title =
    status === 'error' && env.health_error
      ? env.health_error
      : checked
        ? `Checked ${checked}`
        : 'Not checked yet';
  return (
    <div className={styles.healthCell}>
      <span className={styles.health} data-status={status} title={title}>
        <span className={styles.dot} aria-hidden="true" />
        {label}
      </span>
      {showTime && checked ? <span className={styles.meta}>{checked}</span> : null}
    </div>
  );
}

export function SchemaCell({ env }: { env: EvalEnvironment }) {
  if (!env.schema_hash) return <span className={styles.empty}>—</span>;
  const fetched = relTime(env.schema_fetched_at);
  return (
    <div className={styles.healthCell}>
      <span className={styles.mono} title={env.schema_hash}>
        {shortHash(env.schema_hash)}
      </span>
      {fetched ? (
        <span className={styles.meta} title={absTime(env.schema_fetched_at)}>
          fetched {fetched}
        </span>
      ) : null}
    </div>
  );
}

export function SlotsStatusTag({ env }: { env: EvalEnvironment }) {
  if (!env.current_schema_id) return <span className={styles.empty}>—</span>;
  const summary = env.model_slots;
  const counts = summary?.counts;
  if (summary?.needs_confirmation) {
    const pending = (counts?.proposed ?? 0) + (counts?.stale ?? 0);
    return (
      <Tag tone="warning" title={`${pending} slot(s) proposed or stale`}>
        Needs grouping
      </Tag>
    );
  }
  return (
    <Tag tone="success" title={`${counts?.confirmed ?? 0} confirmed slot(s)`}>
      Grouped
    </Tag>
  );
}

export function DefaultPresetTag({ env }: { env: EvalEnvironment }) {
  const version = env.official_preset_version;
  if (version == null)
    return (
      <span className={styles.empty} title="No default preset published yet">
        —
      </span>
    );
  return <Tag kind="version">v{version}</Tag>;
}
