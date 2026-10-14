/** Pure model of the passes panel: row view, issue summaries, remembered metric. */
import type { RunPass } from '@/api/dashboardTypes';

export type PassView = { kind: 'pass'; pass: RunPass; status: string };
export type QueuedView = { kind: 'queued'; first: number; last: number; count: number; notRun: boolean };

/** One row per started pass; waiting passes collapse into one row ("not run" once the run ended without them). */
export function passRowsView(
  passes: RunPass[],
  samples: number,
  runStatus: string,
): { rows: Array<PassView | QueuedView> } {
  const terminal = { STOPPED: 'stopped', FAILED: 'failed', COMPLETED: 'completed' }[runStatus.toUpperCase()];
  const notRun = ['STOPPED', 'FAILED', 'CANCELED', 'CANCELLED'].includes(runStatus.toUpperCase());
  const rows: Array<PassView | QueuedView> = [];
  const have = new Set(passes.map((p) => p.pass_number));
  const queued: number[] = [];
  for (const p of passes) {
    const raw = String(p.status || 'unknown').toLowerCase();
    if (raw === 'pending') queued.push(p.pass_number);
    else rows.push({ kind: 'pass', pass: p, status: raw === 'running' && terminal ? terminal : raw });
  }
  for (let n = 1; n <= samples; n++) if (!have.has(n)) queued.push(n);
  if (queued.length) {
    queued.sort((a, b) => a - b);
    rows.push({
      kind: 'queued',
      first: queued[0]!,
      last: queued[queued.length - 1]!,
      count: queued.length,
      notRun,
    });
  }
  return { rows };
}

/** "Passes 4–5 waiting to start" / "Pass 3 not run". */
export function queuedText(q: QueuedView): string {
  const label = q.first === q.last ? `Pass ${q.first}` : `Passes ${q.first}–${q.last}`;
  return `${label} ${q.notRun ? 'not run' : 'waiting to start'}`;
}

export interface PassIssue {
  kind: 'task' | 'metric' | 'retry';
  count: number;
  glyph: string;
  tone: 'danger' | 'warning' | 'info';
  /** Tooltip and accessible text. */
  text: string;
}

/** The non-zero issues of one pass (task errors, metric errors, retries), in severity order. */
export function passIssues(
  p: Pick<RunPass, 'task_error_count' | 'metric_error_count' | 'retry_count' | 'error_count'>,
): PassIssue[] {
  const taskErr = p.task_error_count ?? 0;
  const metricErr = p.metric_error_count ?? 0;
  const retries = p.retry_count ?? 0;
  const anyErr = p.error_count ?? 0;
  const out: PassIssue[] = [];
  const task = taskErr || (anyErr && !metricErr ? anyErr : 0);
  if (task)
    out.push({
      kind: 'task',
      count: task,
      glyph: '!',
      tone: 'danger',
      text: `${task} task error${task > 1 ? 's' : ''} in this pass`,
    });
  if (metricErr)
    out.push({
      kind: 'metric',
      count: metricErr,
      glyph: '~',
      tone: 'warning',
      text: `${metricErr} metric error${metricErr > 1 ? 's' : ''} in this pass`,
    });
  if (retries)
    out.push({
      kind: 'retry',
      count: retries,
      glyph: '↻',
      tone: 'info',
      text: `${retries} retr${retries === 1 ? 'y' : 'ies'} in this pass`,
    });
  return out;
}

/** One sentence for the whole Issues cell ("1 task error, 2 retries in this pass"), '' when clean. */
export function issuesSummaryText(issues: PassIssue[]): string {
  return issues.map((i) => i.text.replace(/ in this pass$/, '')).join(', ');
}

export const passesMetricKey = (slug: string) => `qym:runs:passes-metric:${slug}`;

/** The metric last chosen in a passes panel of this project (session only). */
export function readStoredMetric(slug: string): string | null {
  try {
    return sessionStorage.getItem(passesMetricKey(slug)) || null;
  } catch {
    return null;
  }
}

export function writeStoredMetric(slug: string, metric: string): void {
  try {
    sessionStorage.setItem(passesMetricKey(slug), metric);
  } catch {
    /* storage unavailable: the choice just is not remembered */
  }
}

/** Metrics shown in the pass table: the parent's visible ones in its order, else every metric of the run. */
export function mirroredMetrics(
  all: string[],
  visible: string[] | undefined,
): { shown: string[]; hidden: string[] } {
  if (!visible) return { shown: all, hidden: [] };
  const set = new Set(all);
  const shown = visible.filter((m) => set.has(m));
  const shownSet = new Set(shown);
  return { shown, hidden: all.filter((m) => !shownSet.has(m)) };
}
