import { useState } from 'react';
import type { LiveWorkerVersion } from '@/api/liveWorker';
import { formatRelative } from '@/lib/format';
import { errorSentence } from '@/lib/http';
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, useToast, type Column } from '@/ui';
import { WorkerBlock } from './WorkerBlock';
import type { WorkerCallbacks } from './types';
import styles from '../../worker.module.css';

export function HistoryBlock({
  versions,
  onRestore,
  busy,
}: { versions: LiveWorkerVersion[]; busy?: boolean } & Pick<WorkerCallbacks, 'onRestore'>) {
  const [restore, setRestore] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const columns: Column<LiveWorkerVersion>[] = [
    { id: 'version', header: 'Version', mono: true, priority: 1, cell: (row) => `v${row.version}` },
    {
      id: 'created_at',
      header: 'When',
      priority: 2,
      cell: (row) => <span title={row.created_at}>{formatRelative(row.created_at)}</span>,
    },
    {
      id: 'created_by',
      header: 'Who',
      priority: 2,
      cell: (row) => (
        <span className={styles.wrap} dir="auto">
          {row.created_by ?? '—'}
        </span>
      ),
    },
    {
      id: 'note',
      header: 'Note',
      priority: 2,
      cell: (row) => (
        <span className={styles.wrap} dir="auto">
          {row.note ?? '—'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      priority: 2,
      cell: (row) => (
        <Button isDisabled={busy} onPress={() => setRestore(row.version)}>
          Restore
        </Button>
      ),
    },
  ];
  return (
    <WorkerBlock name="history" title="History">
      {versions.length ? (
        <DataTable
          aria-label="Settings history"
          rows={versions}
          columns={columns}
          rowKey={(row) => row.version}
          responsive="cards"
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
