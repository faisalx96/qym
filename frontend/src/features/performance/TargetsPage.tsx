/** The Targets list: every target of the project, archived ones too. A manager adds, changes, archives, restores. */
import { useMemo, useState } from 'react';
import {
  isPerformanceSwitchedOff,
  performanceError,
  useArchivePerformanceTarget,
  useRestorePerformanceTarget,
  type PerformanceTarget,
  type RestoreTargetError,
  type SaveTargetError,
} from '@/api/performance';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Icon,
  InlineNotice,
  PageHeader,
  Skeleton,
  StaleBanner,
} from '@/ui';
import {
  useMixedPerformanceTargets,
  useMixedPerformanceSetup,
  isPlatformTarget,
  type PlatformTarget,
} from '@/api/performancePlatform';
import { TargetKindDialog } from './components/platform/TargetKindDialog';
import { MixedTargetsTable } from './components/platform/MixedTargetsTable';
import { SwitchedOff } from './components/home/SwitchedOff';
import { MANAGER_ONLY, TargetsTable, type TargetActions } from './components/targets/TargetsTable';
import { count, span } from './lib/format';
import styles from './components/targets/targets.module.css';

const DESCRIPTION =
  'The systems a run can test. A project manager adds, changes, archives and restores them.';
const NO_ANSWER = 'The request did not reach qym. Nothing was changed. Try again.';

/** The platform's own caps under the list; skeleton values while the list loads. */
function Limits({ users, seconds }: { users?: number; seconds?: number }) {
  const value = <Skeleton kind="value" label="Loading the platform limits" />;
  return (
    <p className={styles.note}>
      Whatever a target allows, the platform lets a run reach at most{' '}
      {users === undefined ? value : count(users)} users and last at most{' '}
      {seconds === undefined ? value : span(seconds)}.
    </p>
  );
}

export function TargetsPage({ slug }: { slug: string }) {
  useDocumentTitle('Targets · Performance');
  const query = useMixedPerformanceTargets(slug);
  const setup = useMixedPerformanceSetup(slug);
  const archive = useArchivePerformanceTarget(slug);
  const { mutate: restoreTarget } = useRestorePerformanceTarget(slug);
  /** The dialog: 'new' adds a target, a target changes it, null is closed. */
  const [editing, setEditing] = useState<PerformanceTarget | PlatformTarget | 'new' | null>(null);
  const [archiving, setArchiving] = useState<PerformanceTarget | PlatformTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ name: string; message: string } | null>(null);

  const read = query.data;
  const canManage = read?.can_manage ?? false;

  const actions = useMemo<TargetActions>(
    () => ({
      canManage,
      busyId,
      onEdit: (target) => setEditing(target),
      onArchive: (target) => setArchiving(target),
      onRestore: (target) => {
        setRefusal(null);
        setBusyId(target.id);
        restoreTarget(target.id, {
          onError: (error) =>
            setRefusal({
              name: target.name,
              message: performanceError<RestoreTargetError>(error)?.message ?? NO_ANSWER,
            }),
          onSettled: () => setBusyId(null),
        });
      },
    }),
    [canManage, busyId, restoreTarget],
  );

  // The page's main action (primary, §3.1). A person who is not a manager sees it, and the row tiles, locked with the
  // reason; while the list loads it waits in place, so the header does not move.
  const add = (
    <Button
      variant="primary"
      icon={<Icon name="plus" size={12} />}
      onPress={() => setEditing('new')}
      isDisabled={!canManage}
      disabledReason={read ? MANAGER_ONLY : 'The targets are loading'}
    >
      Add target
    </Button>
  );

  if (query.isError && isPerformanceSwitchedOff(query.error))
    return (
      <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
        <PageHeader title="Targets" description={DESCRIPTION} />
        <div className={styles.body}>
          <SwitchedOff />
        </div>
      </div>
    );
  if (!read)
    return (
      <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
        <PageHeader title="Targets" description={DESCRIPTION} actions={add} />
        <div className={styles.body}>
          {query.isError ? (
            <ErrorState
              error={query.error}
              title="Couldn’t load the targets"
              onRetry={() => void query.refetch()}
            />
          ) : (
            // The loaded layout with skeleton values (§7): the table's own loading rows, then the limits line.
            <div className={styles.frame} data-performance-loading="targets">
              <TargetsTable slug={slug} targets={[]} actions={actions} loading />
              <Limits />
            </div>
          )}
        </div>
      </div>
    );

  const open = read.targets.filter((target) => !target.archived_at);
  return (
    <div className={`${fullWidth} ${styles.page}`} data-performance-block="content">
      <PageHeader
        title="Targets"
        description={DESCRIPTION}
        actions={read?.targets.some(isPlatformTarget) && !canManage ? undefined : add}
      />
      <div className={styles.body}>
        {/* A refresh that fails after the list was shown keeps it, dimmed, under the banner (§3.7). */}
        {query.isError ? (
          <StaleBanner
            since={new Date(query.dataUpdatedAt)}
            filtersApplied
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {!read.encryption_ready ? (
          <InlineNotice tone="warning" lead="Sign-in cannot be saved yet.">
            This platform has no encryption key set, so it cannot store sign-in details. An operator sets the
            key; until then no run can start.
          </InlineNotice>
        ) : null}
        {refusal ? (
          <InlineNotice
            tone="danger"
            lead={`${refusal.name} was not restored.`}
            data-testid="performance-target-refusal"
          >
            {refusal.message}
          </InlineNotice>
        ) : null}
        {read.targets.length ? (
          <>
            {read.targets.some(isPlatformTarget) ? (
              <MixedTargetsTable
                slug={slug}
                targets={read.targets}
                canManage={canManage}
                onEdit={setEditing}
                onArchive={setArchiving}
                onRestore={(target) => restoreTarget(target.id)}
              />
            ) : (
              <TargetsTable
                slug={slug}
                targets={read.targets.filter(
                  (target): target is PerformanceTarget => !isPlatformTarget(target),
                )}
                actions={actions}
                stale={query.isError}
              />
            )}
            <Limits users={read.platform_limits.max_users} seconds={read.platform_limits.max_duration_s} />
          </>
        ) : (
          <Card>
            <EmptyState
              icon={<Icon name="target" />}
              title="No targets yet"
              body="A target is the address of a system to test. A project manager adds targets."
            />
          </Card>
        )}
        {editing !== null ? (
          <TargetKindDialog
            legacyChatOnly={
              !setup.data?.platform &&
              read.targets.length > 0 &&
              !read.targets.some((target) => 'kind' in target)
            }
            slug={slug}
            onClose={() => setEditing(null)}
            target={editing === 'new' ? null : editing}
            targets={open}
            maxUsersLimit={read.platform_limits.max_users}
          />
        ) : null}
        <ConfirmDialog
          open={archiving !== null}
          onOpenChange={(next) => (next ? undefined : setArchiving(null))}
          title={`Archive the target “${archiving?.name ?? ''}”?`}
          description="It can no longer be chosen for a new run. Its runs and their reports stay, and a manager can restore it later."
          confirmLabel="Archive target"
          tone="danger"
          onConfirm={async () => {
            if (!archiving) return;
            setRefusal(null);
            try {
              await archive.mutateAsync(archiving.id);
            } catch (error) {
              // The dialog stays open with the API's own sentence; the list is read again by itself.
              throw new Error(performanceError<SaveTargetError>(error)?.message ?? NO_ANSWER);
            }
          }}
        />
      </div>
    </div>
  );
}
