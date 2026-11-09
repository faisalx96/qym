/**
 * Run header actions (review group R4, owner notes Nov 1): "Compare with reference" (accent) and one neutral
 * "Actions" menu that holds the review action for the viewer's role, Export HTML, Transfer ownership and Delete,
 * each with its action tile as in the runs-list row menu; the review log behind the hero's "History N" button (C027,
 * C055); and the reject comment under the run name (C047). The dialogs are the runs list's own (RunDialogs).
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { useRunsPage } from '@/api/dashboard';
import type { RunRow } from '@/api/dashboardTypes';
import { runKeys, useReviewHistoryQuery } from '@/api/runs';
import { useAuth, useProjectContext } from '@/features/shell';
import { AnalysisSpark } from '@/features/runs-list/AnalyzeAction';
import { isActiveRun } from '@/features/runs-list/polling';
import { RunDialogs, type DialogState } from '@/features/runs-list/RunDialogs';
import {
  ActionTile,
  Button,
  CountTile,
  DropdownMenu,
  Icon,
  LinkButton,
  Popover,
  useToast,
  type MenuItemSpec,
} from '@/ui';
import { exportRunHtml } from '../lib/exportRun';
import {
  analyzerHref,
  compareWithReferenceUrl,
  pickReferenceRun,
  runActionItems,
  type RunActionId,
} from '../lib/runActions';
import { useRunPage } from '../RunContext';
import type { Run } from '../types';
import { ReviewLogList, who } from './RunPanels';
import styles from './RunHero.module.css';

/** The dataset filter value the runs list uses (name, or name␟version). */
function datasetValue(run: Run): string {
  const name = run.dataset_name ?? '';
  return name && run.dataset_version ? `${name}␟${run.dataset_version}` : name;
}

/** The runs of the same task and dataset, for the reference rule (C034). */
function useReference(run: Run, slug: string) {
  const dataset = datasetValue(run);
  const page = useRunsPage(
    {
      project_slug: slug,
      filters: { tasks: run.task_name ? [run.task_name] : [], ...(dataset ? { datasets: [dataset] } : {}) },
      limit: 50,
    },
    { enabled: !!slug && !!run.task_name, keepPrevious: false },
  );
  return pickReferenceRun(page.data?.rows ?? [], run);
}

export function RunHeaderActions({ run, slug }: { run: Run; slug: string }) {
  const { project, readOnly, canManage, isAdmin } = useProjectContext();
  const { me } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [exporting, setExporting] = useState(false);
  const reference = useReference(run, slug);
  const { model, api, basePath } = useRunPage();
  const row = {
    run_id: run.run_id,
    run_name: run.run_name || run.run_id,
    external_run_id: run.external_run_id ?? null,
    owner: run.owner ?? null,
    status: run.status,
  } as unknown as RunRow;
  const items = runActionItems(run.status, {
    isOwner: !!run.owner?.id && run.owner.id === me.id,
    canManage,
    isAdmin,
    readOnly,
  });
  // RF3 (C113): auto-analysis first, in purple with its spark, as in the runs-list row menu; a live run has none yet
  const analyze: MenuItemSpec[] = isActiveRun({ status: run.status } as Pick<RunRow, 'status'>)
    ? []
    : [
        {
          id: 'analyze',
          label: 'Open auto-analysis',
          tone: 'meta',
          icon: <ActionTile tone="meta" icon={<AnalysisSpark filled={false} />} />,
        },
      ];
  const menu: MenuItemSpec[] = analyze.concat(
    items.map((it) => ({
      id: it.id,
      label: it.label,
      tone: it.tone,
      separatorBefore: it.separatorBefore,
      icon: <ActionTile icon={it.icon} tone={it.tone === 'danger' ? 'danger' : 'default'} />,
    })),
  );
  const onAction = (id: string) => {
    if (id === 'analyze') {
      navigate(analyzerHref(basePath, model.viewPass, api.selectedMetric));
      return;
    }
    const action = id as RunActionId;
    if (action === 'export') {
      // C173: the file is today's run page, read-only, built from this page's data
      if (exporting) return;
      setExporting(true);
      toast.show('Preparing the export…', { tone: 'info' });
      void exportRunHtml(queryClient, {
        runId: run.run_id,
        slug,
        project,
        me,
        runName: run.run_name || run.run_id,
        path: location.pathname + location.search + location.hash,
      })
        .catch((e: unknown) =>
          toast.show(`Couldn’t export the run: ${e instanceof Error ? e.message : 'unknown error'}`, {
            tone: 'error',
          }),
        )
        .finally(() => setExporting(false));
    } else if (action === 'submit' || action === 'resubmit') setDialog({ kind: 'submit', rows: [row] });
    else if (action === 'transfer') setDialog({ kind: 'transfer', row });
    else if (action === 'delete')
      setDialog({
        kind: 'delete',
        refs: [run.run_id],
        revisions: {},
        names: [row.external_run_id || row.run_name],
      });
    else setDialog({ kind: 'workflow', action, row });
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: runKeys.all(run.run_id) });
  return (
    <>
      {reference ? (
        <LinkButton
          variant="accent"
          size="sm"
          href={compareWithReferenceUrl(
            projectPath(run.project?.slug ?? '', 'compare'),
            reference,
            run.run_id,
          )}
          icon={<Icon name="split" size={14} />}
          title={`Compare with ${reference.name} (${
            reference.kind === 'approved'
              ? 'the latest approved run'
              : reference.kind === 'official'
                ? 'the latest official run'
                : 'the previous run'
          } of this task and dataset)`}
          data-testid="compare-with-reference"
        >
          Compare with reference
        </LinkButton>
      ) : null}
      <DropdownMenu
        label="Run actions"
        trigger={
          <Button size="sm" variant="neutral" icon={<Icon name="more" size={14} />} data-testid="run-actions">
            Actions
          </Button>
        }
        items={menu}
        onAction={onAction}
      />
      <RunDialogs
        slug={slug}
        projectId={project.id}
        state={dialog}
        onClose={() => {
          setDialog(null);
          refresh();
        }}
        onDeleted={() => navigate(projectPath(slug))}
        onSubmitted={refresh}
      />
    </>
  );
}

/** "History N" beside the run's status: the review log opens on click (C027). Nothing when there are no events. */
export function ReviewLog({ runId, enabled }: { runId: string; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const { data } = useReviewHistoryQuery(runId, enabled);
  const events = data?.events ?? [];
  if (!events.length) return null;
  return (
    <Popover
      label="Review history"
      placement="bottom start"
      isOpen={open}
      onOpenChange={setOpen}
      testId="review-log-popover"
      trigger={
        <Button size="sm" variant="neutral" aria-expanded={open} data-testid="review-history-button">
          History<CountTile>{events.length}</CountTile>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
        </Button>
      }
    >
      <div className={styles.reviewLog} data-testid="review-history">
        <div className={styles.reviewLogTitle}>Review history</div>
        <ReviewLogList events={events} />
      </div>
    </Popover>
  );
}

/** On a rejected run, the reject comment under the run name (C047); the owner resubmits from the Actions menu. */
export function RejectNote({ runId, status, enabled }: { runId: string; status: string; enabled: boolean }) {
  const rejected = String(status || '').toUpperCase() === 'REJECTED';
  const { data } = useReviewHistoryQuery(runId, enabled && rejected);
  if (!rejected) return null;
  const last = [...(data?.events ?? [])].reverse().find((e) => e.action === 'reject');
  if (!last) return null;
  return (
    <p className={styles.rejectNote} data-testid="reject-note">
      Rejected by {who(last.actor)}
      {last.comment ? <>: “{last.comment}”</> : '.'} Resubmit it from Actions.
    </p>
  );
}
