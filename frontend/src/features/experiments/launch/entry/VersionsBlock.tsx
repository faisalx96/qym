import type { EvalEnvironment } from '@/api/evalCommon';
import { useEnvTasks, useEnvVersioning } from '@/api/launch';
import { Button, Tag } from '@/ui';
import { useLaunch } from '../LaunchContext';
import styles from './entry.module.css';

const VERSION_KEYS = ['agent_version', 'image_version', 'kb_version'];
const VERSION_LABELS: Record<string, string> = {
  agent_version: 'agent',
  image_version: 'image',
  kb_version: 'kb',
};

function show(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * The Evaluation Service versions a run started now would record, shown inside the environment's
 * own box (home view and Customize step 1 share the picker) for a ticked environment only. One
 * react-query entry per environment, read when the box is first ticked and again on its Refresh.
 * Read only: nothing user-typed is stored on an experiment.
 */
export function EnvVersions({ env, projectId }: { env: EvalEnvironment; projectId: string }) {
  const query = useEnvVersioning(projectId, env.id, true);
  // The box's Refresh reads the tasks too, when the environment offers them (the Task row below).
  const offersTasks = Boolean(env.evaluator_capabilities?.task);
  const tasksQuery = useEnvTasks(projectId, env.id, offersTasks);
  const hasTaskRow = offersTasks && tasksQuery.data?.status !== 'unsupported';
  const data = query.data;
  const status =
    query.isPending || query.isFetching ? 'loading' : query.isError ? 'error' : data?.status;
  const details = data?.versioning_details ?? {};
  const keys = [
    ...VERSION_KEYS,
    ...Object.keys(details)
      .filter((k) => !VERSION_KEYS.includes(k))
      .sort(),
  ];
  return (
    <div className={styles.versionLine} data-env-version={env.id} data-status={status}>
      <span className={styles.versionLabel}>Versions</span>
      {status === 'loading' ? (
        // The loaded DOM with a placeholder per value: the box keeps its height when it fills (rule 7).
        <>
          <span className={styles.srOnly} role="status">
            Reading…
          </span>
          <dl className={styles.versionList} aria-busy="true">
            {VERSION_KEYS.map((key) => (
              <div key={key} className={styles.versionItem}>
                <dt>{VERSION_LABELS[key]}</dt>
                <dd>
                  <span className={styles.skelValue} aria-hidden="true" />
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : status === 'unsupported' ? (
        <span className={[styles.help, styles.versionState].join(' ')}>
          Not supported by this environment (its Evaluation Service is older than v1.2).
        </span>
      ) : status === 'ok' ? (
        <dl className={styles.versionList}>
          {keys.map((key) => (
            <div key={key} className={styles.versionItem}>
              <dt>{VERSION_LABELS[key] ?? key}</dt>
              {details[key] == null ? (
                <dd data-unset="">not set</dd>
              ) : (
                <dd>
                  <Tag kind="version">{show(details[key])}</Tag>
                </dd>
              )}
            </div>
          ))}
        </dl>
      ) : (
        <span className={[styles.errorText, styles.versionState].join(' ')}>
          Couldn’t read:{' '}
          {data?.error || (query.error instanceof Error ? query.error.message : 'unknown error')}
        </span>
      )}
      <span className={styles.versionRefresh}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={hasTaskRow ? `Refresh versions and tasks of ${env.name}` : `Refresh versions of ${env.name}`}
          // A request already in flight is kept (no cancel and re-issue): Refresh twice is harmless.
          onPress={() => {
            void query.refetch({ cancelRefetch: false });
            if (offersTasks) void tasksQuery.refetch({ cancelRefetch: false });
          }}
        >
          Refresh
        </Button>
      </span>
    </div>
  );
}

function SummaryLine({ env, projectId, many }: { env: EvalEnvironment; projectId: string; many: boolean }) {
  const query = useEnvVersioning(projectId, env.id, true);
  const details = query.data?.versioning_details ?? {};
  const parts = VERSION_KEYS.filter((k) => details[k] != null).map((k) => show(details[k]));
  const text = query.data?.status === 'ok' && parts.length ? parts.join(' · ') : '—';
  return (
    <span>
      {many ? `${env.name}: ` : ''}
      {text}
    </span>
  );
}

/** Read-only recap of the versions of the ticked environments (the review's "Versions" row). */
export function VersionsSummary() {
  const { selectedEnvs, projectId } = useLaunch();
  return (
    <span className={styles.versionSummary}>
      {selectedEnvs.map((env) => (
        <SummaryLine key={env.id} env={env} projectId={projectId} many={selectedEnvs.length > 1} />
      ))}
    </span>
  );
}
