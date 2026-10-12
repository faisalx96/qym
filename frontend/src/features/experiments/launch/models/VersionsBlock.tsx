import { useEffect, useState } from 'react';
import type { EvalEnvironment } from '@/api/evalCommon';
import { useEnvVersioning } from '@/api/launch';
import { Button, Text } from '@/ui';
import { useLaunch } from '../LaunchContext';
import styles from './models.module.css';

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

function VersionRow({
  env,
  projectId,
  refreshKey,
}: {
  env: EvalEnvironment;
  projectId: string;
  refreshKey: number;
}) {
  const query = useEnvVersioning(projectId, env.id, true);
  const { refetch } = query;
  useEffect(() => {
    if (refreshKey > 0) void refetch();
  }, [refreshKey, refetch]);
  const data = query.data;
  const status =
    query.isPending || (query.isFetching && refreshKey > 0)
      ? 'loading'
      : query.isError
        ? 'error'
        : data?.status;
  const details = data?.versioning_details ?? {};
  const keys = [
    ...VERSION_KEYS,
    ...Object.keys(details)
      .filter((k) => !VERSION_KEYS.includes(k))
      .sort(),
  ];
  return (
    <div className={styles.versionRow} data-env-version={env.id} data-status={status}>
      <span className={styles.versionName}>{env.name}</span>
      {status === 'loading' ? (
        <span className={styles.hint}>Reading…</span>
      ) : status === 'unsupported' ? (
        <span className={styles.hint}>
          Not supported by this environment (its Evaluation Service is older than v1.2).
        </span>
      ) : status === 'ok' ? (
        <dl className={styles.versionList}>
          {keys.map((key) => (
            <div key={key} className={styles.versionItem}>
              <dt>{VERSION_LABELS[key] ?? key}</dt>
              {details[key] == null ? <dd data-unset="">not set</dd> : <dd>{show(details[key])}</dd>}
            </div>
          ))}
        </dl>
      ) : (
        <span className={styles.errorText}>
          Couldn’t read:{' '}
          {data?.error || (query.error instanceof Error ? query.error.message : 'unknown error')}
        </span>
      )}
    </div>
  );
}

/** What a run started now would record as its versioning details, read live from each environment. */
export function VersionsBlock() {
  const { selectedEnvs, projectId } = useLaunch();
  const [tick, setTick] = useState(0);
  if (!selectedEnvs.length) return null;
  return (
    <div className={styles.versions} role="group" aria-label="Current versions">
      <div className={styles.head}>
        <Text variant="md" weight={600} as="span">
          Current versions
        </Text>
        <span className={styles.hint}>What a run started now records as its versioning details.</span>
        <span className={styles.spacer} />
        <Button variant="ghost" onPress={() => setTick((n) => n + 1)}>
          Refresh
        </Button>
      </div>
      {selectedEnvs.map((env) => (
        <VersionRow key={env.id} env={env} projectId={projectId} refreshKey={tick} />
      ))}
    </div>
  );
}
