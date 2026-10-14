import { useEffect, useState } from 'react';
import type { EvalEnvironment } from '@/api/evalCommon';
import { useEnvVersioning } from '@/api/launch';
import { Button, Card, Tag, Text } from '@/ui';
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
        <span className={styles.help}>Reading…</span>
      ) : status === 'unsupported' ? (
        <span className={styles.help}>
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
        <span className={styles.errorText}>
          Couldn’t read:{' '}
          {data?.error || (query.error instanceof Error ? query.error.message : 'unknown error')}
        </span>
      )}
    </div>
  );
}

/**
 * Home view: the Evaluation Service versions a run started now would record (`versioning_details`),
 * read once when an environment is ticked and again on Refresh. Nothing to decide: it is what each
 * environment reports; a custom value goes in "Versioning details" (Customize, step 1).
 */
export function VersionsBlock({ onCustomize }: { onCustomize?: () => void }) {
  const { selectedEnvs, projectId } = useLaunch();
  const [tick, setTick] = useState(0);
  if (!selectedEnvs.length) return null;
  return (
    <Card
      as="section"
      tone="meta"
      aria-label="Current versions"
      role="group"
      header={
        <div className={styles.versionsHead}>
          <Text variant="md" weight={600} as="span">
            Evaluation Service versions
          </Text>
          <span className={styles.help}>What a run started now records as its versioning details.</span>
          <span className={styles.versionsActions}>
            {onCustomize ? (
              <Button variant="ghost" onPress={onCustomize}>
                Add versioning details
              </Button>
            ) : null}
            <Button variant="ghost" onPress={() => setTick((n) => n + 1)}>
              Refresh
            </Button>
          </span>
        </div>
      }
    >
      <div className={styles.versionRows}>
        {selectedEnvs.map((env) => (
          <VersionRow key={env.id} env={env} projectId={projectId} refreshKey={tick} />
        ))}
      </div>
    </Card>
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

/** Read-only recap of the versions chosen on the home view (the review's "Versions" row). */
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
