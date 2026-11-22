import { useState } from 'react';
import type { LiveWorkerVersion } from '@/api/liveWorker';
import { formatHeaderDate, formatTableDate } from '@/lib/dates';
import { formatRelative } from '@/lib/format';
import { errorSentence } from '@/lib/http';
import { textDirAttrs } from '@/lib/text';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  StateTag,
  Text,
  Timeline,
  UserName,
  useToast,
  type TimelineItem,
} from '@/ui';
import { WorkerBlock } from './WorkerBlock';
import type { WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

const sectionNames: Record<string, string> = {
  evaluation: 'Evaluation',
  models: 'Models',
  langfuse: 'Langfuse',
  evaluator_traces: 'Evaluator traces',
  dataiku: 'Dataiku',
  database: 'Database',
};

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
        // cv5 Z6: the shared Timeline, newest first: the version and its state, the person, the note, Restore
        <Timeline
          aria-label="Settings history"
          markAlign="start"
          items={versions.map((version): TimelineItem => {
            const running = version.version === runningVersion;
            return {
              key: String(version.version),
              rowData: { 'data-worker-version': String(version.version) },
              time: formatTableDate(version.created_at),
              timeTitle: `${formatHeaderDate(version.created_at)} (${formatRelative(version.created_at)})`,
              dateTime: version.created_at,
              icon: running ? 'play' : 'settings',
              tone: running ? 'info' : 'neutral',
              title: (
                <span className={styles.inline}>
                  <Text as="span" variant="base" weight={600} tone="primary">
                    v{version.version}
                  </Text>
                  {running ? <StateTag tone="info">Running</StateTag> : null}
                </span>
              ),
              meta: version.created_by ? (
                <UserName id={version.created_by_user_id} name={version.created_by} />
              ) : undefined,
              detail:
                version.note || version.changed_sections ? (
                  <span className={styles.versionDetails}>
                    {version.note ? (
                      <Text
                        as="span"
                        variant="base"
                        tone="secondary"
                        className={styles.wrap}
                        {...textDirAttrs(version.note)}
                      >
                        {version.note}
                      </Text>
                    ) : null}
                    {version.changed_sections ? (
                      <Text as="span" variant="sm" tone="muted" className={styles.wrap}>
                        Changed:{' '}
                        {version.version === 1
                          ? 'All settings'
                          : version.changed_sections
                              .map((section) => sectionNames[section] ?? section)
                              .join(', ') || 'None'}
                      </Text>
                    ) : null}
                  </span>
                ) : undefined,
              actions: running ? undefined : (
                <Button isDisabled={busy} onPress={() => setRestore(version.version)}>
                  Restore
                </Button>
              ),
            };
          })}
        />
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
