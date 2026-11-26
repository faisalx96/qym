import { screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { PerformanceRunRead, PerformanceSummaryLevel } from '@/api/performance';
import { chartLevels } from '../components/run/ChartsTab';
import { levelRows } from '../components/run/levels';
import { runNotice } from '../components/run/words';
import { rehearsal3RunLimit } from './rehearsalReads';
import { setup } from './runHarness';

// The third rehearsal's first run (see rehearsalReads.ts): no level broke a limit, but the whole-run time limit
// did, and the suite stopped the run.

it('says which whole-run limit broke and that it stopped the run, as the Limits table shows it Broken', async () => {
  const notice = runNotice(rehearsal3RunLimit)!;
  expect(notice.lead).toBe('No break.');
  expect(notice.text).toBe(
    'No level broke a limit up to 4 users. The run stopped after 3m 31s because a whole-run limit broke: 95% of answers within 4s, measured 4.4s.',
  );
  expect(notice.text).not.toContain('The run ended');

  setup(rehearsal3RunLimit);
  expect(await screen.findByTestId('performance-run-notice')).toHaveTextContent(notice.text);
});

it('keeps "The run ended" when the run went to its end with every whole-run limit kept', () => {
  const summary = rehearsal3RunLimit.summary!;
  const kept: PerformanceRunRead = {
    ...rehearsal3RunLimit,
    summary: {
      ...summary,
      ended_by: 'plan',
      thresholds: summary.thresholds.map((item) => ({ ...item, ok: true })),
    },
  };
  expect(runNotice(kept)!.text).toBe(
    'No level broke a limit up to 4 users. The run ended as planned after 3m 31s.',
  );
});

/** The rehearsal read with level 6 sent as the runner may send a level without data: its numbers null. */
function withEmptyLevel(held: number | null): PerformanceRunRead {
  const summary = rehearsal3RunLimit.summary!;
  const empty = (item: PerformanceSummaryLevel): PerformanceSummaryLevel =>
    item.level === 6
      ? {
          ...item,
          answers: null,
          error_pct: null,
          per_minute: null,
          hold_elapsed_pct: held,
          p50_ms: null,
          p95_ms: null,
        }
      : item;
  return { ...rehearsal3RunLimit, summary: { ...summary, levels: summary.levels.map(empty) } };
}

it('shows "–" for the numbers a level without data sent as null, without an error', async () => {
  const cut = withEmptyLevel(6.6);
  const row = levelRows(cut).find((item) => item.level === 6)!;
  expect(row).toMatchObject({ word: 'Not finished', answers: null, per_minute: null, error_pct: null });
  expect(chartLevels(cut).find((item) => item.level === 6)).toMatchObject({ p95_ms: null, error_pct: null });
  expect(runNotice(cut)!.text).toContain('The run stopped after 3m 31s');

  const never = withEmptyLevel(null);
  expect(levelRows(never).find((item) => item.level === 6)).toMatchObject({
    answers: null,
    per_minute: null,
  });
  expect(runNotice(never)!.text).toContain('a whole-run limit broke');

  setup(cut);
  await screen.findByTestId('performance-run-notice');
  const level6 = document.querySelector<HTMLElement>('[data-performance-level-row="6"]')!;
  expect(level6).toHaveTextContent('Not finished');
  expect(level6).toHaveTextContent('6% of the hold ran, no answers');
  // Answers, Per minute, Errors, p50, p95, p99, first byte and the rest: every number cell is the dash.
  expect(within(level6).getAllByText('–').length).toBeGreaterThanOrEqual(3);
  expect(level6).not.toHaveTextContent(/null|NaN|undefined/);
});
