/**
 * The Live activity line and the re-evaluation steps, as plain values. Everything here restates what the worker
 * reported: no step, count or bar is advanced on the client, so a worker that stops reporting reads as silence.
 */
import { jobTurnId, type LiveActivityRead, type LiveActivitySlot } from '@/api/liveWorker';
import { formatAgoSeconds, formatElapsed, formatShortDayKey, toDate } from '@/lib/dates';
import { humanizeKey } from '@/lib/humanizeKey';

const STEP_LABELS: Record<string, string> = {
  fetch: 'Downloading the trace',
  judge: 'Judging',
  sql: 'Checking the SQL',
  chart: 'Checking the chart',
  save: 'Saving the verdict',
};

/**
 * The worker's order of work on one turn, used only before it has reported anything (a queued re-evaluation). Once
 * the worker reports, `activity.steps` is the order that is drawn.
 */
export const DEFAULT_STEPS: readonly string[] = ['fetch', 'chart', 'judge', 'sql', 'save'];

/** The words for a worker step; a step this page does not know is shown by its own name. */
export function stepLabel(step: string): string {
  return STEP_LABELS[step] ?? humanizeKey(step);
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export type ActivityState = 'idle' | 'live' | 'job' | 'queued' | 'stale' | 'paused' | 'waiting';

export interface ActivityView {
  state: ActivityState;
  tone: 'info' | 'neutral' | 'warning';
  shape: 'orbit' | 'ring' | 'pause';
  /** What is running: 'Live evaluation', 'Backfill, Nov 3 – Nov 9', 'Re-evaluating one turn'. */
  what: string;
  /** 'Turn 8 of 20' or 'Step 3 of 5'. */
  count: string | null;
  /** Finished parts out of all parts, as reported. */
  bar: { done: number; total: number; label: string } | null;
  /** The step name, the idle sentence or the worker's own reason. */
  detail: string | null;
  /** 'Updated 3s ago', 'Last check 8s ago, next in 22s', 'No report from the worker for 2m 5s'. */
  freshness: string | null;
  /** Changes only when a new report arrives. */
  beat: string | null;
  /** The state without its ticking numbers, for a screen reader. */
  announce: string;
}

/** The server's clock now: its time when the answer arrived, plus the time since. */
export function serverNow(read: Pick<LiveActivityRead, 'server_time' | 'received_at'>, now: number): number {
  const server = toDate(read.server_time)?.getTime();
  return server === undefined || !Number.isFinite(read.received_at) ? now : server + (now - read.received_at);
}

function secondsSince(value: string | null | undefined, at: number): number | null {
  const time = toDate(value)?.getTime();
  return time === undefined ? null : Math.max(0, Math.floor((at - time) / 1000));
}

function dayRange(params: { since_day?: string; until_day?: string } | undefined): string | null {
  if (!params?.since_day) return null;
  const from = formatShortDayKey(params.since_day);
  return params.until_day && params.until_day !== params.since_day
    ? `${from} – ${formatShortDayKey(params.until_day)}`
    : from;
}

const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** `current`: the worker reports the turn it is on, so the line can name it; otherwise only what is finished. */
function turnCount(done: number | null, total: number | null, current: boolean) {
  if (total === null || total < 1) return { count: null, bar: null };
  const finished = Math.min(done ?? 0, total);
  return {
    count:
      current && finished < total ? `Turn ${finished + 1} of ${total}` : `${finished} of ${total} turns done`,
    bar: { done: finished, total, label: 'Turns finished' },
  };
}

/** A slot's step position: the worker's own index, or the step's place in the reported order. */
function stepPosition(slot: LiveActivitySlot, steps: string[]): { index: number; count: number } | null {
  if (!slot.step) return null;
  const listed = steps.indexOf(slot.step);
  const index = whole(slot.step_index) ?? (listed >= 0 ? listed + 1 : null);
  const count = whole(slot.step_count) ?? (steps.length || null);
  return index !== null && count !== null && index >= 1 && index <= count ? { index, count } : null;
}

/**
 * The one line for a Live page. `turnId` is the turn the page shows, so its own re-evaluation reads "this turn".
 * Returns null when the answer does not describe a worker (an unexpected body).
 */
export function activityView(
  read: LiveActivityRead,
  now: number,
  options: { turnId?: string; jobParams?: { since_day?: string; until_day?: string } } = {},
): ActivityView | null {
  const worker = read.worker;
  if (!worker || typeof worker !== 'object') return null;
  const at = serverNow(read, now);
  const steps = read.activity?.steps ?? [];
  const job = read.job ?? null;
  const reported = read.activity?.job ?? null;
  // The reported slot belongs to the listed job unless it names another one.
  const jobSlot = reported && (!job || !reported.job_id || reported.job_id === job.id) ? reported : null;
  const liveSlot = read.activity?.live ?? null;
  const lastReport = worker.last_report_at ?? jobSlot?.reported_at ?? liveSlot?.reported_at ?? null;
  const updated = lastReport ? `Updated ${formatAgoSeconds(lastReport, at)}` : null;
  const kind = job?.kind ?? jobSlot?.kind ?? null;
  const jobTurn = (job ? jobTurnId(job) : null) ?? (kind === 'reevaluate' ? jobSlot?.trace_id : null) ?? null;
  const jobWord = kind === 'backfill_preview' ? 'Preview' : kind === 'backfill' ? 'Backfill' : null;
  // The day range of a backfill: on the job when the server sends its params, else as the worker page read it.
  const range = dayRange(job?.params ?? options.jobParams);
  const title =
    kind === null
      ? 'Live evaluation'
      : kind === 'reevaluate'
        ? options.turnId && jobTurn === options.turnId
          ? 'Re-evaluating this turn'
          : 'Re-evaluating one turn'
        : `${jobWord ?? humanizeKey(kind)}${range ? `, ${range}` : ''}`;

  // What the active slot last said about its position, used by the running and the silent line alike.
  const slot = kind !== null ? jobSlot : liveSlot;
  const position = slot ? stepPosition(slot, steps) : null;
  const progress = job?.progress;
  const counted =
    kind === 'reevaluate'
      ? position
        ? {
            count: `Step ${position.index} of ${position.count}`,
            bar: { done: position.index - 1, total: position.count, label: 'Steps finished' },
          }
        : { count: null, bar: null }
      : kind === 'backfill_preview'
        ? {
            count: whole(progress?.found) !== null ? `${whole(progress?.found)} turns found` : null,
            bar: null,
          }
        : turnCount(
            whole(slot?.done) ?? (kind !== null ? whole(progress?.evaluated) : null),
            whole(slot?.total) ?? (kind !== null ? whole(progress?.found) : null),
            Boolean(slot),
          );

  if (worker.stale) {
    const silent = secondsSince(lastReport, at);
    return {
      state: 'stale',
      tone: 'warning',
      shape: 'pause',
      what: title,
      ...counted,
      detail: slot?.step ? `Last step: ${lowerFirst(stepLabel(slot.step))}` : null,
      freshness:
        silent === null
          ? 'No report from the worker yet'
          : `No report from the worker for ${formatElapsed(silent)}`,
      beat: null,
      announce: `${title}. The worker is not reporting.`,
    };
  }
  if (worker.state === 'paused' || worker.state === 'waiting') {
    const paused = worker.state === 'paused';
    const what = paused ? 'Evaluation paused' : 'Worker is waiting';
    const noun =
      kind === 'reevaluate' ? 're-evaluation' : kind === 'backfill_preview' ? 'preview' : 'backfill';
    const detail =
      worker.reason?.trim() ||
      (paused && kind !== null ? `The ${noun} waits until evaluation resumes` : null);
    return {
      state: worker.state,
      tone: 'neutral',
      shape: paused ? 'pause' : 'ring',
      what,
      count: null,
      bar: null,
      detail,
      freshness: updated,
      beat: lastReport,
      announce: `${what}${detail ? `. ${detail}` : ''}`,
    };
  }
  if (kind !== null) {
    if (job?.status === 'queued' && !(jobSlot && jobSlot.job_id === job.id)) {
      return {
        state: 'queued',
        tone: 'neutral',
        shape: 'ring',
        what: title,
        count: null,
        bar: null,
        detail: 'Queued, waiting for the worker',
        freshness: updated,
        beat: lastReport,
        announce: `${title}. Queued, waiting for the worker.`,
      };
    }
    const waiting = progress?.waiting?.trim();
    const detail = slot?.step
      ? stepLabel(slot.step)
      : waiting
        ? `Waiting: ${waiting}`
        : kind === 'reevaluate' && read.activity
          ? 'Starting'
          : null;
    return {
      state: 'job',
      tone: 'info',
      shape: 'orbit',
      what: title,
      ...counted,
      detail,
      freshness: updated,
      beat: lastReport,
      announce: `${title}. Running.`,
    };
  }
  if (liveSlot && (liveSlot.step || (whole(liveSlot.total) ?? 0) > 0)) {
    return {
      state: 'live',
      tone: 'info',
      shape: 'orbit',
      what: title,
      ...counted,
      detail: liveSlot.step ? stepLabel(liveSlot.step) : null,
      freshness: updated,
      beat: lastReport,
      announce: `${title}. Evaluating new turns.`,
    };
  }
  const sincePoll = secondsSince(worker.last_poll_at, at);
  const interval = whole(worker.poll_interval_s);
  const next = sincePoll !== null && interval !== null && interval > sincePoll ? interval - sincePoll : null;
  // A worker that does not report its activity cannot say whether it is idle.
  const idle = Boolean(read.activity);
  return {
    state: 'idle',
    tone: idle ? 'neutral' : 'info',
    shape: idle ? 'ring' : 'orbit',
    what: title,
    count: null,
    bar: null,
    detail: idle ? 'Idle, nothing to evaluate' : 'Running',
    freshness:
      worker.last_poll_at && sincePoll !== null
        ? `Last check ${formatAgoSeconds(worker.last_poll_at, at)}${next !== null ? `, next in ${formatElapsed(next)}` : ''}`
        : updated,
    beat: lastReport,
    announce: `${title}. ${idle ? 'Idle.' : 'Running.'}`,
  };
}

export interface ReevaluationStep {
  key: string;
  label: string;
  state: 'done' | 'now' | 'next' | 'stopped';
}

export interface ReevaluationProgress {
  /** The worker has picked the job up and reports on it. */
  running: boolean;
  /** Empty when the worker does not report steps. */
  steps: ReevaluationStep[];
  /** 'Step 3 of 5', once the worker names a step. */
  count: string | null;
  /** 'Updated 3s ago' or the silent-worker sentence. */
  freshness: string | null;
  stale: boolean;
  beat: string | null;
}

/**
 * The five steps of this turn's re-evaluation. Before the worker picks the job up every step is 'next'; a silent
 * worker leaves the last reported step marked 'stopped'. A step that does not apply to the turn (no chart, replay
 * off) is never reported: the worker moves past it, so every step before the reported one reads 'done', never stuck.
 * `queued`: the job has not started, so with no report yet the usual order is drawn.
 */
export function reevaluationProgress(
  read: LiveActivityRead | undefined,
  now: number,
  target: { turnId: string; jobId?: string | null; queued?: boolean },
): ReevaluationProgress {
  const worker = read?.worker && typeof read.worker === 'object' ? read.worker : null;
  const names = read?.activity?.steps ?? (target.queued ? [...DEFAULT_STEPS] : []);
  const reported = read?.activity?.job ?? null;
  const slot =
    reported &&
    reported.kind === 'reevaluate' &&
    (reported.trace_id === target.turnId || (target.jobId != null && reported.job_id === target.jobId))
      ? reported
      : null;
  const at = read ? serverNow(read, now) : now;
  const stale = Boolean(worker?.stale);
  const lastReport = worker?.last_report_at ?? slot?.reported_at ?? null;
  const silent = secondsSince(lastReport, at);
  const position = slot ? stepPosition(slot, names) : null;
  const current = slot?.step ? names.indexOf(slot.step) : -1;
  return {
    running: Boolean(slot),
    steps: names.map((key, index) => ({
      key,
      label: stepLabel(key),
      state:
        current < 0
          ? 'next'
          : index < current
            ? 'done'
            : index === current
              ? stale
                ? 'stopped'
                : 'now'
              : 'next',
    })),
    count: position ? `Step ${position.index} of ${position.count}` : null,
    freshness: stale
      ? silent === null
        ? 'No report from the worker yet'
        : `No report from the worker for ${formatElapsed(silent)}`
      : lastReport
        ? `Updated ${formatAgoSeconds(lastReport, at)}`
        : null,
    stale,
    beat: stale ? null : lastReport,
  };
}
