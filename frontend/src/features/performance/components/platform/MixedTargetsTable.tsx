import type { PerformanceTarget } from '@/api/performance';
import { isPlatformTarget, type PlatformTarget } from '@/api/performancePlatform';
import { DataTable, Flag, StateTag, Tooltip, type Column } from '@/ui';
import { TargetEnvironment } from '../shared';
import { SessionHint } from './SessionDialog';
import { Focusable } from 'react-aria-components';
import styles from './platform.module.css';

type Target = PerformanceTarget | PlatformTarget;
export function MixedTargetsTable({
  targets,
  canManage,
  onEdit,
  onArchive,
  onRestore,
}: {
  slug: string;
  targets: Target[];
  canManage: boolean;
  onEdit: (target: Target) => void;
  onArchive: (target: Target) => void;
  onRestore: (target: Target) => void;
}) {
  const columns: Column<Target>[] = [
    {
      id: 'target',
      header: 'Target',
      wrap: true,
      cell: (t) => (
        <div className={styles.row}>
          {t.name}
          <TargetEnvironment production={t.is_production} />
          {t.archived_at ? <Flag icon="archive">Archived</Flag> : null}
        </div>
      ),
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: (t) => (isPlatformTarget(t) ? 'Estishraf platform' : 'Insightor chat'),
    },
    {
      id: 'address',
      header: 'Address',
      wrap: true,
      cell: (t) => <span className={styles.title}>{t.base_url}</span>,
    },
    { id: 'users', header: 'Highest users', type: 'number', cell: (t) => t.max_users ?? '–' },
    {
      id: 'sign-in',
      header: 'Sign-in',
      wrap: true,
      cell: (t) => {
        const hint = isPlatformTarget(t) ? t.tokens.find((item) => item.name === 'session_cookie') : null;
        const mark = (
          <StateTag tone={t.sign_in_ready ? 'success' : 'warning'}>
            {t.sign_in_ready ? 'Sign-in saved' : hint?.expired ? 'Sign-in ran out' : 'No sign-in saved'}
          </StateTag>
        );
        return hint ? (
          <Tooltip content={<SessionHint token={hint} />}>
            <Focusable>
              <span role="img" aria-label="Saved sign-in details">
                {mark}
              </span>
            </Focusable>
          </Tooltip>
        ) : (
          mark
        );
      },
    },
  ];
  return (
    <DataTable
      aria-label="Targets"
      rows={targets}
      rowKey={(t) => t.id}
      columns={columns}
      responsive="scroll"
      rowActions={
        canManage
          ? (t) => [
              { id: 'edit', label: 'Edit target', icon: 'edit', onPress: () => onEdit(t) },
              t.archived_at
                ? { id: 'restore', label: 'Restore target', icon: 'retry', onPress: () => onRestore(t) }
                : {
                    id: 'archive',
                    label: 'Archive target',
                    icon: 'archive',
                    tone: 'danger',
                    onPress: () => onArchive(t),
                  },
            ]
          : undefined
      }
    />
  );
}
