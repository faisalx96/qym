/** Performance run page: what happened and where the run is, as sentences. Pure: a read in, words out. */
import { isPerformanceRunActive, type PerformanceProgress, type PerformanceRunRead } from '@/api/performance';
import { formatAgoSeconds, formatTime } from '@/lib/dates';
import { clock, count, pct, secs, span } from '../../lib/format';
import { limitWords } from './limitWords';

/** The person a sentence names, so a page can draw them as a UserName where the name stands in `text`. */
export interface NoticePerson {
  id: string | null;
  name: string;
}

export interface RunNotice {
  tone: 'danger' | 'warning' | 'info' | 'neutral';
  lead: string;
  text: string;
  /** Set when `text` names the person who stopped the run (A8): their name is in `text` as written here. */
  person?: NoticePerson;
}

/** The text split around the first place it names the person: before, the person, after. */
export function aroundPerson(
  text: string,
  person: NoticePerson | undefined,
): [string, NoticePerson, string] | null {
  if (!person) return null;
  const at = text.indexOf(person.name);
  return at < 0 ? null : [text.slice(0, at), person, text.slice(at + person.name.length)];
}

/** A sentence from another source, ended with a full stop when it has none, and a space after it. */
const sentence = (text: string | null | undefined) => {
  const said = text?.trim();
  return said ? `${/[.!?]$/.test(said) ? said : `${said}.`} ` : '';
};

/** How much of a hold ran, in whole percent, never rounded up to a full hold: 38.6 -> 38. */
export const heldPct = (value: number) => Math.floor(value);

/** Levels whose hold was cut short, said in words: "Level 30 ran 96% of its hold." */
export function cutShortWords(read: Pick<PerformanceRunRead, 'summary'>): string {
  // A hold that began counts, also one with no answer inside it (a stop early in the hold).
  const cut = (read.summary?.levels ?? []).flatMap((item) => {
    const held = item.hold_elapsed_pct ?? 0;
    return held > 0 && held < 100 ? [{ ...item, held }] : [];
  });
  return cut
    .map(
      (item) =>
        `Level ${item.level} ran ${heldPct(item.held)}% of its hold${
          item.has_data ? '' : ', with no answer inside it'
        }.`,
    )
    .join(' ');
}

/**
 * What the result says, built from its fields. The suite's own sentence (`verdict_reason`) is never shown:
 * it is in the suite's words ("Breaks at 4 VUs (latency).").
 */
export function resultWords(read: Pick<PerformanceRunRead, 'summary' | 'config'>): string {
  const summary = read.summary;
  if (!summary) return '';
  const plan = read.config.plan;
  const headline = summary.headline;
  switch (summary.verdict) {
    case 'breakpoint_found': {
      const users = headline.breaking_level_users;
      const level = summary.levels.find((item) => item.level === users);
      const reason = headline.breaking_reason;
      const slow = reason ? reason !== 'errors' : Boolean(level?.latency_breach);
      const failing = reason ? reason !== 'latency' : Boolean(level?.error_breach);
      const time = level?.p95_ms
        ? `95% of them took up to ${secs(level.p95_ms)}, over the ${secs(plan.limit_ms, 0)} limit`
        : '';
      const errors = level
        ? `${pct(level.error_pct)} failed, over the ${plan.max_error_rate_pct}% limit`
        : '';
      if (slow && failing)
        return `Answers got too slow and too many failed at ${users} users${
          time || errors ? `: ${[time, errors].filter(Boolean).join('; ')}` : ''
        }.`;
      if (failing) return `Too many answers failed at ${users} users${errors ? `: ${errors}` : ''}.`;
      if (slow) return `Answers got too slow at ${users} users${time ? `: ${time}` : ''}.`;
      return `A limit broke at ${users} users.`;
    }
    case 'not_reached':
      return headline.safe_load_users
        ? `No level broke a limit up to ${headline.safe_load_users} users.`
        : 'No level broke a limit.';
    case 'pass':
      return 'Every limit was kept.';
    case 'fail': {
      const broken = summary.thresholds.filter((item) => !item.ok).map((item) => limitWords(item).limit);
      if (!broken.length) return 'A limit broke.';
      return `${broken.length === 1 ? 'This limit broke' : `${broken.length} limits broke`}: ${broken.join('; ')}.`;
    }
    case 'invalid_auth':
      return 'The sign-in ran out during the run, so its answers cannot be judged.';
    case 'invalid_no_data': {
      // Answers outside the holds (warm-up, ramps) are real answers, but no level can be judged from them.
      const answers = headline.answers_total ?? 0;
      return answers > 0
        ? `${answers === 1 ? '1 answer' : `${count(answers)} answers`} came back, but none inside a level’s hold, so no level can be judged.`
        : 'No answer came back, so there is nothing to judge.';
    }
    default:
      return '';
  }
}

/** The one line under the header that says what happened. A run that simply runs has none. */
export function runNotice(read: PerformanceRunRead): RunNotice | null {
  const { run, summary, progress } = read;
  const status = read.effective_status;
  const reason = read.status_reason?.message ?? run.status_reason ?? run.error;
  const person = run.stop_requested_by ?? 'Someone';
  // The stopper as a person (A8): only when the read names one, with the id that goes with the name.
  const named = (notice: RunNotice): RunNotice =>
    run.stop_requested_by
      ? { ...notice, person: { id: run.stop_requested_by_user_id ?? null, name: run.stop_requested_by } }
      : notice;
  const given = run.stop_reason ? ` Reason given: ${run.stop_reason}` : '';
  if (status === 'queued')
    return {
      tone: 'neutral',
      lead: 'Queued.',
      text: 'Waiting for the runner to pick this run up. That usually takes a few seconds. If no runner takes it in time, the run expires.',
    };
  if (status === 'expired')
    return {
      tone: 'neutral',
      lead: 'Expired.',
      text: reason ?? 'No runner picked this run up in time. Nothing was sent to the target.',
    };
  if (isPerformanceRunActive(status) && read.token_needed)
    return {
      tone: 'warning',
      lead: 'Needs a new token.',
      text: `The refresh token was rejected at ${clock(progress?.auth.rejected_at)}. Users fail one by one as their sign-in runs out, and the level being measured will not be counted. Send a new token to keep the run going.`,
    };
  if (status === 'stopping')
    return named({
      tone: 'info',
      lead: 'Stopping.',
      text: `${person} asked to stop this run at ${clock(run.stop_requested_at)}. The users leave within a few seconds. What was measured so far is kept.${given}`,
    });
  if (status === 'failed')
    return {
      tone: 'danger',
      lead: 'Failed.',
      text: `${sentence(reason ?? 'The run failed.')}The log has the details.`,
    };
  if (status === 'interrupted') {
    const open =
      read.late_results_until && Date.parse(read.late_results_until) > Date.parse(read.server_time);
    return {
      tone: 'danger',
      lead: 'Interrupted.',
      text: `${sentence(reason ?? 'The runner stopped reporting.')}What it reported until then is shown below.${
        open ? ` The runner can still send its result until ${formatTime(read.late_results_until)}.` : ''
      }`,
    };
  }
  if (!summary) {
    if (status === 'stopped')
      return named({
        tone: 'warning',
        lead: 'Stopped.',
        text: `${sentence(reason ?? `${person} stopped this run.`)}No result was stored.${given}`,
      });
    return null;
  }
  const never = summary.levels
    .filter((item) => !item.has_data && (item.hold_elapsed_pct ?? 0) <= 0)
    .map((item) => item.level);
  const neverWords = !never.length
    ? ''
    : never.length === 1
      ? ` Level ${never[0]} was never reached.`
      : ` Levels ${never[0]} to ${never[never.length - 1]} were never reached.`;
  const cut = summary.counts?.interrupted
    ? ` ${summary.counts.interrupted} answers were still in flight and are not counted.`
    : '';
  if (status === 'stopped') {
    const short = cutShortWords(read);
    return named({
      tone: 'warning',
      lead: 'Stopped.',
      text: `${person} stopped this run after ${span(run.duration_s)}. ${sentence(resultWords(read))}${short}${neverWords}${cut}${given}`.trim(),
    });
  }
  if (summary.verdict === 'breakpoint_found')
    return {
      tone: 'warning',
      lead: `Breaks at ${summary.headline.breaking_level_users} users.`,
      text: `${sentence(resultWords(read))}The run ${
        summary.ended_by === 'auto_stop'
          ? 'stopped by itself'
          : summary.ended_by === 'plan'
            ? 'ended as planned'
            : 'ended'
      } after ${span(run.duration_s)}.${neverWords}${cut}`,
    };
  const failed = summary.verdict === 'fail' || summary.verdict.startsWith('invalid');
  // No level broke, yet the suite stopped the run: a whole-run limit broke, which the Limits table shows as Broken.
  const runLimits =
    summary.verdict === 'not_reached' && summary.ended_by === 'auto_stop' ? brokenRunLimits(read) : [];
  return {
    tone: failed ? 'danger' : 'info',
    lead:
      summary.verdict === 'fail'
        ? 'Failed.'
        : summary.verdict === 'pass'
          ? 'Passed.'
          : failed
            ? 'Not valid.'
            : 'No break.',
    text: runLimits.length
      ? `${sentence(resultWords(read))}The run stopped after ${span(run.duration_s)} because ${
          runLimits.length === 1 ? 'a whole-run limit' : `${runLimits.length} whole-run limits`
        } broke: ${runLimits.join('; ')}.`
      : `${sentence(resultWords(read))}The run ended ${
          summary.ended_by === 'plan' ? 'as planned ' : ''
        }after ${span(run.duration_s)}.`,
  };
}

/** The whole-run limits the result marks broken, in the Limits table's words: "95% of answers within 4s, measured 4.4s". */
function brokenRunLimits(read: Pick<PerformanceRunRead, 'summary'>): string[] {
  return (read.summary?.thresholds ?? [])
    .filter((item) => !item.ok)
    .map(limitWords)
    .filter((words) => words.where === 'Whole run')
    .map((words) => (words.measured === '–' ? words.limit : `${words.limit}, measured ${words.measured}`));
}

const PREFLIGHT: Record<NonNullable<PerformanceProgress['step']>, string> = {
  dataset: 'Getting ready: reading the questions',
  sign_in: 'Getting ready: checking the sign-in',
  plan_check: 'Getting ready: checking the plan',
  starting_k6: 'Getting ready: starting the test',
};

function nowWords(read: PerformanceRunRead, progress: PerformanceProgress): string {
  const top = read.config.plan.max_users ?? progress.users_max;
  switch (progress.phase) {
    case 'stopping':
      return 'Stopping';
    case 'finishing':
      return 'Writing the result';
    case 'preflight':
      return progress.step ? PREFLIGHT[progress.step] : 'Getting ready';
    case 'baseline':
      return `Warming up with ${progress.users ?? progress.stage?.target_users ?? 'the first'} users`;
    case 'ramp':
      return progress.stage ? `Going to ${progress.stage.target_users} users` : 'Adding users';
    case 'cooldown':
      return 'Winding down';
    case 'steady':
      return `${progress.users ?? read.config.plan.users ?? 1} users, steady`;
    default:
      return progress.level === null
        ? 'Measuring'
        : `Level ${progress.level}${top ? ` of ${top}` : ''}: measuring`;
  }
}

function comingUp(read: PerformanceRunRead, progress: PerformanceProgress): string {
  const stage = progress.stage;
  if (progress.phase === 'stopping' || progress.phase === 'finishing' || !stage) return 'the result';
  const left = span(Math.max(0, stage.end_s - progress.elapsed_s));
  if (progress.phase === 'preflight') return 'the first users';
  if (progress.phase === 'baseline' || progress.phase === 'ramp') return `measuring starts in ${left}`;
  if (progress.phase === 'steady' || progress.phase === 'cooldown') return `the result in ${left}`;
  const levels = read.config.plan.levels;
  const last = levels.length > 0 && progress.level === levels[levels.length - 1];
  return last ? `the result in ${left}` : `next level in ${left}`;
}

/** The age of a report given in seconds, in the one freshness helper's words: 'just now', '8s ago', '2m 5s ago'. */
export const reportAge = (seconds: number) => formatAgoSeconds(0, seconds * 1000);

/**
 * Where the run is: Now, Coming up, Elapsed, Time left, Last report. `sinceReport` is the age of the last
 * report in seconds, counted on from the moment the read arrived.
 */
export function statusLine(read: PerformanceRunRead, sinceReport: number | null): [string, string][] {
  const { progress, config } = read;
  if (!progress)
    return [
      ['Now', 'Waiting for the runner'],
      ['Coming up', 'a check of the sign-in and the dataset, then the first users'],
      ['Planned length', span(config.plan.total_seconds)],
    ];
  return [
    ['Now', nowWords(read, progress)],
    ['Coming up', comingUp(read, progress)],
    ['Elapsed', span(progress.elapsed_s)],
    ['Time left', `up to ${span(Math.max(0, progress.planned_s - progress.elapsed_s))}`],
    ...(progress.answers && progress.answers.in_flight !== null
      ? ([
          [
            'In flight',
            `${count(progress.answers.in_flight)}, the oldest for ${span(progress.answers.oldest_in_flight_s)}`,
          ],
        ] as [string, string][])
      : []),
    ['Last report', sinceReport === null ? '–' : reportAge(sinceReport)],
  ];
}

/**
 * The same facts as one InlineNotice line under the header (B22): "Now:" as its lead, then each fact with its
 * label, "Level 30 of 60: measuring · Coming up: next level in 3m 30s · Elapsed 21m 30s · …".
 */
export function whereLine(
  read: PerformanceRunRead,
  sinceReport: number | null,
): { lead: string; text: string } {
  const [now, ...rest] = statusLine(read, sinceReport);
  return {
    lead: `${now![0]}:`,
    text: [
      now![1],
      ...rest.map(([label, value]) => `${label}${label === 'Coming up' ? ':' : ''} ${value}`),
    ].join(' · '),
  };
}
