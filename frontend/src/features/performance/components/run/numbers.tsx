/**
 * Performance run page: the six numbers between the header and the tabs, while the run goes on and after its result.
 * They are the page's one compact-header strip (§4, B22): a label and a value per cell, what a number means in its
 * help. The facts that were sub-lines stand where they belong: where the run is in the line under the header, the
 * limits in the Progress tab, who stopped it in the header and the notice.
 */
import { Fragment } from 'react';
import type { PerformanceRunRead } from '@/api/performance';
import type { StatStripItem } from '@/ui';
import { P95_HINT, count, pct, secs, span } from '../../lib/format';
import { Quantity } from '../shared';

/** A time value with its unit glyph on the number, smaller and muted (§3.3 stat value, C2): "48.0s". */
const time = (ms: number | null | undefined, digits = 1) =>
  ms === null || ms === undefined ? '–' : <Quantity value={(ms / 1000).toFixed(digits)} unit="s" tight />;

/** A length such as "39m 59s" with each unit glyph on its number: "39m 59s", every unit quiet. */
const length = (seconds: number | null | undefined) => {
  const words = span(seconds);
  const parts = [...words.matchAll(/(\d+)([hms])/g)];
  if (!parts.length) return words;
  return (
    <span>
      {parts.map(([, value, unit], index) => (
        <Fragment key={unit}>
          {index ? ' ' : null}
          <Quantity value={value} unit={unit} tight />
        </Fragment>
      ))}
    </span>
  );
};

/** While the run is active, and for a run that ended with no result: what the runner reported last. */
export function liveStrip(read: PerformanceRunRead): StatStripItem[] {
  const { progress, config } = read;
  const limit = config.plan.limit_ms;
  const top = config.plan.max_users ?? config.plan.users;
  const now = progress?.levels.find((item) => item.state === 'running');
  const answers = progress?.answers;
  const kinds = progress?.errors_by_kind;
  return [
    {
      key: 'users',
      label: 'Users now',
      help: config.plan.step_users
        ? `${config.plan.step_users} more users at each level.`
        : 'The users stay the same for the whole run.',
      value:
        progress && progress.users !== null ? (
          <Quantity value={progress.users} unit={top ? `of ${top}` : undefined} />
        ) : (
          '–'
        ),
    },
    {
      key: 'answers',
      label: 'Answers',
      help: answers
        ? `Answers that finished, ${count(answers.follow_ups)} of them follow-ups.`
        : 'Answers that finished.',
      value: count(answers?.finished),
    },
    {
      key: 'ok',
      label: 'OK',
      help: answers
        ? `${count(answers.ok)} of ${count(answers.finished)} answers were OK.`
        : 'The share of answers that were OK.',
      value: answers?.finished ? pct((answers.ok / answers.finished) * 100) : '–',
    },
    {
      key: 'level-p95',
      label: 'p95 this level',
      help: `${P95_HINT} The limit is ${secs(limit, 0)}.`,
      value: time(now?.p95_ms),
    },
    {
      key: 'run-p95',
      label: 'p95 whole run',
      help: `All levels together. ${P95_HINT}`,
      value: time(progress?.p95_ms),
    },
    {
      key: 'errors',
      label: 'Errors',
      help: kinds
        ? `Server ${kinds.server} · Timeout ${kinds.network} · Sign-in ${kinds.auth} · Rate limit ${kinds.rate_limit}`
        : 'Answers that failed.',
      value: count(answers?.errors),
    },
  ];
}

/** With a result: the capacity numbers of a Breakpoint, or the plain numbers of a Smoke or Soak. */
export function finalStrip(read: PerformanceRunRead): StatStripItem[] {
  const summary = read.summary;
  if (!summary) return liveStrip(read);
  const headline = summary.headline;
  const limit = read.config.plan.limit_ms;
  const runLength: StatStripItem = { key: 'length', label: 'Run length', value: length(headline.duration_s) };
  if (read.config.test_type !== 'breakpoint')
    return [
      {
        key: 'p95',
        label: 'p95',
        help: `${P95_HINT} The limit is ${secs(limit, 0)}.`,
        value: time(headline.p95_ms),
      },
      {
        key: 'answers',
        label: 'Answers',
        help: `Answers that finished, ${count(headline.errors_total ?? 0)} of them failed.`,
        value: count(headline.answers_total),
      },
      {
        key: 'errors',
        label: 'Error rate',
        help: `The share of answers that failed. The limit is ${read.config.plan.max_error_rate_pct}%.`,
        value: pct(headline.error_rate_pct),
      },
      {
        key: 'quality',
        label: 'Quality',
        help: 'Average quality of the answers, out of 100.',
        value: headline.quality_mean === null ? '–' : headline.quality_mean.toFixed(1),
      },
      {
        key: 'users',
        label: 'Users',
        help: 'The users stayed the same for the whole run.',
        value: headline.max_users ?? '–',
      },
      runLength,
    ];
  const users = (value: number | null) =>
    value === null ? '–' : <Quantity value={value} unit={value === 1 ? 'user' : 'users'} />;
  return [
    {
      key: 'safe',
      label: 'Safe load',
      help: 'The highest level that passed.',
      value: users(headline.safe_load_users),
    },
    {
      key: 'breaks',
      label: 'Breaks at',
      help: headline.breaking_level_users
        ? `The first level that broke a limit: ${headline.breaking_reason === 'errors' ? 'over the error limit' : 'over the time limit'}.`
        : summary.ended_by === 'stop'
          ? 'The run was stopped before any level broke a limit.'
          : headline.safe_load_users === null
            ? 'No level passed, and none broke a limit.'
            : `No level broke a limit up to ${headline.safe_load_users} users.`,
      value: headline.breaking_level_users ? users(headline.breaking_level_users) : 'Not found',
    },
    {
      key: 'recommended',
      label: 'Recommended',
      help: 'The recommended maximum: 80% of the safe load.',
      value: users(headline.recommended_max_users),
    },
    {
      key: 'p95',
      label: 'p95 at safe load',
      help: `${P95_HINT} The limit is ${secs(limit, 0)}.`,
      value: time(headline.p95_at_safe_load_ms),
    },
    {
      key: 'measured',
      label: 'Answers measured',
      help: `Answers inside the levels’ holds; ${count(headline.answers_total)} finished in all.`,
      value: count(headline.answers_measured),
    },
    runLength,
  ];
}
