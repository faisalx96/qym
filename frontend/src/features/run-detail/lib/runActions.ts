/**
 * Run header actions (review group R4: C034, C031, C047). One "Actions" menu holds the review action for the viewer's
 * role, Export HTML, Transfer ownership and Delete; and the reference run for "Compare with reference".
 */
import type { RunRow } from '@/api/dashboardTypes';
import type { IconName } from '@/ui';

export type RunActionId =
  'resubmit' | 'submit' | 'approve' | 'reject' | 'unapprove' | 'unreject' | 'export' | 'transfer' | 'delete';

export interface RunActionItem {
  id: RunActionId;
  label: string;
  icon: IconName;
  tone?: 'danger';
  separatorBefore?: boolean;
}

export interface RunActionViewer {
  isOwner: boolean;
  canManage: boolean;
  isAdmin: boolean;
  readOnly: boolean;
}

/**
 * The menu, in order: the review action for the viewer's role first (Resubmit on a rejected run, C047; Submit, not
 * "Submit for review", C031), Export HTML, Transfer ownership, then Delete in red after a separator.
 */
export function runActionItems(status: string | null | undefined, viewer: RunActionViewer): RunActionItem[] {
  const s = String(status || '').toUpperCase();
  const items: RunActionItem[] = [];
  if (!viewer.readOnly) {
    const mayReview = viewer.isOwner || viewer.canManage;
    if (s === 'REJECTED' && mayReview) items.push({ id: 'resubmit', label: 'Resubmit', icon: 'send' });
    if ((s === 'COMPLETED' || s === 'FAILED') && mayReview)
      items.push({ id: 'submit', label: 'Submit', icon: 'send' });
    if (viewer.canManage) {
      if (s === 'SUBMITTED')
        items.push(
          { id: 'approve', label: 'Approve', icon: 'check' },
          { id: 'reject', label: 'Reject', icon: 'close', tone: 'danger' },
        );
      if (s === 'APPROVED') items.push({ id: 'unapprove', label: 'Unapprove', icon: 'retry' });
      if (s === 'REJECTED') items.push({ id: 'unreject', label: 'Unreject', icon: 'retry' });
    }
  }
  items.push({ id: 'export', label: 'Export HTML', icon: 'download' });
  if (!viewer.readOnly && viewer.canManage)
    items.push({ id: 'transfer', label: 'Transfer ownership', icon: 'file' });
  if (!viewer.readOnly && (viewer.isAdmin || viewer.canManage || viewer.isOwner))
    items.push({ id: 'delete', label: 'Delete', icon: 'trash', tone: 'danger', separatorBefore: true });
  return items;
}

export interface ReferenceRun {
  runId: string;
  name: string;
  /** Why it is the reference: the latest approved run, else the latest official run, else the previous run. */
  kind: 'approved' | 'official' | 'previous';
}

const FINISHED = new Set(['COMPLETED', 'SUBMITTED', 'APPROVED']);

function startedAt(r: Pick<RunRow, 'started_at' | 'timestamp'>): number {
  const t = Date.parse(r.started_at ?? r.timestamp ?? '');
  return Number.isFinite(t) ? t : 0;
}

/**
 * One reference rule (C034): among runs of the same project, task and dataset, the latest Approved run; else the
 * latest official run; else the previous finished run (started before this one). Null when none exists.
 */
export function pickReferenceRun(
  rows: RunRow[],
  run: { run_id: string; started_at?: string | null; timestamp?: string | null },
): ReferenceRun | null {
  const others = rows.filter((r) => r.run_id !== run.run_id);
  const latest = (list: RunRow[]) =>
    list.reduce<RunRow | null>((best, r) => (!best || startedAt(r) > startedAt(best) ? r : best), null);
  const pick = (r: RunRow | null, kind: ReferenceRun['kind']): ReferenceRun | null =>
    r ? { runId: r.run_id, name: r.external_run_id || r.run_name, kind } : null;
  const approved = latest(others.filter((r) => String(r.status).toUpperCase() === 'APPROVED'));
  if (approved) return pick(approved, 'approved');
  const official = latest(others.filter((r) => r.origin === 'official'));
  if (official) return pick(official, 'official');
  const mine = startedAt({ started_at: run.started_at ?? null, timestamp: run.timestamp ?? '' });
  const previous = latest(
    others.filter((r) => FINISHED.has(String(r.status).toUpperCase()) && (!mine || startedAt(r) < mine)),
  );
  return pick(previous, 'previous');
}

export function compareWithReferenceUrl(compareRoute: string, ref: ReferenceRun, runId: string): string {
  const qs = new URLSearchParams([
    ['runs', ref.runId],
    ['runs', runId],
    ['baseline', ref.runId],
  ]);
  return `${compareRoute}?${qs.toString()}`;
}
