/** Targets list: every target of the project, archived ones too, with what a manager can do to each. */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { PerformanceTarget } from '@/api/performance';
import { performanceRunPath } from '@/app/routes';
import { formatTableDate } from '@/lib/dates';
import { DataTable, Flag, Skeleton, UserName, type Column, type RowAction } from '@/ui';
import { count, span } from '../../lib/format';
import { SignInTag } from '../new/parts';
import { RunStatus, TargetEnvironment } from '../shared';
import {
  isPlaceholder,
  placeholderRows,
  loadingRowCount,
  tagShape,
  withPlaceholders,
  type Placeholder,
} from '../home/placeholders';
import styles from './targets.module.css';

/** Why a person who is not a manager sees the writes locked (they stay in place, disabled, §3.1). */
export const MANAGER_ONLY = 'Only a project manager can change targets';

export interface TargetActions {
  canManage: boolean;
  /** The target a write is under way for: its buttons wait. */
  busyId: string | null;
  onEdit: (target: PerformanceTarget) => void;
  onArchive: (target: PerformanceTarget) => void;
  onRestore: (target: PerformanceTarget) => void;
}

function SignIn({ target }: { target: PerformanceTarget }) {
  const refresh = target.tokens.find((token) => token.name === 'refresh_token');
  return (
    <span className={styles.lines}>
      <span>
        {/* The New run page's sign-in mark, so the words and tones are the same on every page (D12). */}
        <SignInTag target={target} />
      </span>
      {target.settings.auth_server ? (
        <span>
          Sign-in server: <span className={styles.host}>{target.settings.auth_server}</span>
        </span>
      ) : null}
      {target.settings.refresh_cookie_name ? (
        <span>
          Sign-in cookie name: <span className={styles.host}>{target.settings.refresh_cookie_name}</span>
        </span>
      ) : null}
      {refresh ? (
        <span className={`${styles.muted} ${styles.figures}`}>
          {refresh.hint ? `Refresh token ends in ${refresh.hint}, saved` : 'Refresh token saved'}{' '}
          {formatTableDate(refresh.updated_at)}
          {refresh.updated_by ? (
            <>
              {' by '}
              <UserName id={refresh.updated_by_user_id} name={refresh.updated_by} />
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

function columns(slug: string): Column<PerformanceTarget>[] {
  return [
    {
      id: 'name',
      header: 'Target',
      width: 180,
      maxWidth: 180,
      wrap: true,
      primary: true,
      cardTitle: true,
      cell: (t) => (
        <span className={styles.row}>
          <span>{t.name}</span>
          {/* The area's one environment mark (as Live marks a source's environment, cv5 M2). */}
          <TargetEnvironment production={t.is_production} />
          {/* An exception on an item that is normally in use: the grey Flag after the name (§3.3, rule 3). */}
          {t.archived_at ? <Flag icon="archive">Archived</Flag> : null}
        </span>
      ),
    },
    {
      id: 'address',
      header: 'Address',
      minWidth: 200,
      flex: true,
      wrap: true,
      cell: (t) => <span className={styles.host}>{t.base_url}</span>,
    },
    {
      id: 'limits',
      header: 'Limits',
      hint: 'The most a run may ask of this target. The platform has its own limits on top.',
      width: 130,
      maxWidth: 130,
      wrap: true,
      cell: (t) => (
        <span className={styles.lines}>
          <span>{t.max_users === null ? 'No limit of its own' : `At most ${count(t.max_users)} users`}</span>
          {t.max_duration_s === null ? null : <span>At most {span(t.max_duration_s)} per run</span>}
        </span>
      ),
    },
    {
      id: 'sign-in',
      header: 'Sign-in',
      width: 230,
      maxWidth: 230,
      wrap: true,
      cell: (t) => <SignIn target={t} />,
    },
    {
      id: 'last-run',
      header: 'Last run',
      width: 120,
      maxWidth: 120,
      wrap: true,
      cell: (t) =>
        t.last_run ? (
          <span className={styles.row}>
            <Link to={performanceRunPath(slug, t.last_run.id)} data-link="name">
              Run {t.last_run.number}
            </Link>
            <RunStatus status={t.last_run.status} />
          </span>
        ) : (
          <span className={styles.muted}>No run yet</span>
        ),
    },
    {
      id: 'changed',
      header: 'Added and changed',
      width: 180,
      maxWidth: 180,
      wrap: true,
      cell: (t) => (
        <span className={`${styles.lines} ${styles.figures}`}>
          <span>
            Added {formatTableDate(t.created_at)}
            {t.created_by ? (
              <>
                {' by '}
                <UserName id={t.created_by_user_id} name={t.created_by} />
              </>
            ) : null}
          </span>
          {t.updated_at !== t.created_at ? (
            <span className={styles.muted}>Changed {formatTableDate(t.updated_at)}</span>
          ) : null}
          {t.archived_at ? (
            <span className={styles.muted}>Archived {formatTableDate(t.archived_at)}</span>
          ) : null}
        </span>
      ),
    },
  ];
}

/**
 * The writes of a row as table tiles (§3.1 "Icon action"): Edit and Restore green, Archive red. A person who is not a
 * manager sees them disabled with the reason, as is a row whose change is being saved.
 */
function rowActions(actions: TargetActions) {
  return (t: PerformanceTarget | Placeholder): RowAction<PerformanceTarget | Placeholder>[] => {
    // A placeholder row shows the tiles of a target in use, locked while the list loads.
    if (isPlaceholder(t))
      return ['edit', 'archive'].map((id) => ({
        id,
        label: id === 'edit' ? 'Edit' : 'Archive',
        icon: id,
        primary: true,
        danger: id === 'archive',
        disabled: true,
        hint: 'The targets are loading',
        onPress: () => undefined,
      }));
    const locked = !actions.canManage
      ? MANAGER_ONLY
      : actions.busyId === t.id
        ? 'A change is being saved'
        : undefined;
    const common = { primary: true, disabled: locked !== undefined, hint: locked };
    return t.archived_at
      ? [{ id: 'restore', label: 'Restore', icon: 'retry', ...common, onPress: () => actions.onRestore(t) }]
      : [
          { id: 'edit', label: 'Edit', icon: 'edit', ...common, onPress: () => actions.onEdit(t) },
          {
            id: 'archive',
            label: 'Archive',
            icon: 'archive',
            danger: true,
            ...common,
            onPress: () => actions.onArchive(t),
          },
        ];
  };
}

export function TargetsTable({
  slug,
  targets,
  actions,
  loading,
  stale,
}: {
  slug: string;
  targets: PerformanceTarget[];
  actions: TargetActions;
  /** The first read is on its way: the table's own skeleton rows. */
  loading?: boolean;
  /** A refresh failed: the last list stays, dimmed, under the page's StaleBanner. */
  stale?: boolean;
}) {
  const cols = useMemo(
    () =>
      withPlaceholders(columns(slug), {
        shapes: {
          // The sign-in tag, then the saved-token line: it runs to two lines, the second with the person's disc.
          'sign-in': (
            <span className={styles.lines}>
              {tagShape()}
              <Skeleton
                kind="chart"
                height="calc(1lh + var(--badge-height))"
                width="100%"
                label="Loading: the saved token"
              />
            </span>
          ),
          'last-run': tagShape(),
        },
      }),
    [slug],
  );
  const acts = useMemo(() => rowActions(actions), [actions]);
  // Targets in use first, archived ones after them; the API's order inside each group.
  const rows = useMemo<(PerformanceTarget | Placeholder)[]>(
    () =>
      loading
        ? placeholderRows(loadingRowCount(undefined, Number.POSITIVE_INFINITY))
        : [...targets.filter((t) => !t.archived_at), ...targets.filter((t) => t.archived_at)],
    [targets, loading],
  );
  return (
    <DataTable
      aria-label="Targets"
      columns={cols}
      rows={rows}
      rowKey={(t) => t.id}
      rowActions={acts}
      rowProps={(t) =>
        isPlaceholder(t)
          ? { 'data-performance-placeholder': '', 'aria-hidden': 'true' }
          : { 'data-performance-target': t.id, 'data-archived': t.archived_at ? '' : undefined }
      }
      refreshing={stale}
      responsive="cards"
      minWidth={1160}
    />
  );
}
