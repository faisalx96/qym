import { useState } from 'react';
import type { LiveWorkerVersion } from '@/api/liveWorker';
import { formatRelative } from '@/lib/format';
import { errorSentence } from '@/lib/http';
import { Button, ConfirmDialog, EmptyState, ErrorState, StateTag, Text, UserName, useToast } from '@/ui';
import { WorkerBlock } from './WorkerBlock';
import type { WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

export function HistoryBlock({
  versions,
  runningVersion,
  onRestore,
  busy,
}: { versions: LiveWorkerVersion[]; runningVersion?: number | null; busy?: boolean } & Pick<
  WorkerCallbacks,
  'onRestore'
>) {
  const [restore, setRestore] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  return (
    <WorkerBlock name="history" title="Versions">
      {versions.length ? (
        <ul className={styles.versions} aria-label="Settings history">
          {versions.map((version) => (
            <li key={version.version} className={styles.version} data-worker-version={version.version}>
              <Text as="div" variant="md" weight={600} tone="primary" className={styles.inline}>
                v{version.version}
                {version.version === runningVersion ? <StateTag tone="info">Running</StateTag> : null}
              </Text>
              <Text dir="auto" className={styles.wrap}>
                {version.note ?? '—'}
              </Text>
              <div className={`${styles.inline} ${styles.versionMeta}`}>
                <time dateTime={version.created_at} title={version.created_at}>
                  {formatRelative(version.created_at)}
                </time>
                {version.created_by ? (
                  <UserName id={version.created_by_user_id} name={version.created_by} />
                ) : (
                  <Text as="span">—</Text>
                )}
                {version.version !== runningVersion ? (
                  <Button isDisabled={busy} onPress={() => setRestore(version.version)}>
                    Restore
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No versions yet" />
      )}
      {error ? (
        <ErrorState
          compact
          error={error}
          title="Couldn’t restore the settings"
          message={errorSentence(error)}
        />
      ) : null}
      <ConfirmDialog
        open={restore !== null}
        onOpenChange={(open) => {
          if (!open) setRestore(null);
        }}
        title={`Restore version ${restore}?`}
        description="A new version with the same values and tokens is created and applied by the worker."
        confirmLabel="Restore"
        onConfirm={async () => {
          if (restore === null) return;
          setError(null);
          try {
            const result = await onRestore(restore);
            toast.show(`Saved as version ${result.version}`, { tone: 'success' });
          } catch (e) {
            setError(e);
            throw new Error(errorSentence(e));
          }
        }}
      />
    </WorkerBlock>
  );
}
