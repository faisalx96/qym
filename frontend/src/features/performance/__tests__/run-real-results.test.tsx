import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PerformanceThreshold } from '@/api/performance';
import { limitWords } from '../components/run/limitWords';
import { resultWords, runNotice } from '../components/run/words';
import { rehearsalBreaks, rehearsalSoak, rehearsalStopped } from './rehearsalReads';
import { block, setup } from './runHarness';

// The run page over results as a real runner sends them (see rehearsalReads.ts): the suite's own sentence and the
// engine's expressions never reach the page; every limit and number is in the page's words and rounding.

const limit = (patch: Partial<PerformanceThreshold>): PerformanceThreshold => ({
  ok: true,
  scope: 'run',
  metric: 'llm_response_duration',
  measured: null,
  expression: 'p(95)<4000',
  ...patch,
});

describe('a limit of the result in words', () => {
  it.each<[string, Partial<PerformanceThreshold>, string, string]>([
    ['answer time', { measured: 4737.699999999999 }, '95% of answers within 4s', '4.7s'],
    [
      'a long time limit',
      { measured: 3110.9999999999995, expression: 'p(95)<180000' },
      '95% of answers within 180s',
      '3.1s',
    ],
    [
      'failed answers',
      { metric: 'http_req_failed', measured: 0.06818181818181818, expression: 'rate<0.1' },
      'Fewer than 10% of answers fail',
      '6.8%',
    ],
    [
      'no data',
      { metric: 'llm_false_negative_rate', measured: 0, expression: 'rate<0.2' },
      'Fewer than 20% of answers say no data was available',
      '0.0%',
    ],
    [
      'quality',
      { metric: 'llm_quality_score', measured: 97.72727272727273, expression: 'avg>70' },
      'Average quality of the answers above 70 out of 100',
      '97.7',
    ],
    [
      'an engine expression it does not know',
      { metric: 'checks', measured: 0.973, expression: 'rate>0.9' },
      'Checks: share above 90%',
      '97.3%',
    ],
    [
      'something it cannot read',
      { metric: 'iteration_duration', measured: 812.44, expression: 'p(90)<1000 && max<5000' },
      'Iteration duration: p90 below 1000 && max below 5000',
      '812.4',
    ],
    [
      'a sample already in words',
      { metric: 'p95_ms', measured: 196400, expression: '95% of answers within 180s', scope: 'Level 50' },
      '95% of answers within 180s',
      '196.4s',
    ],
  ])('%s', (_, patch, words, measured) => {
    const said = limitWords(limit(patch));
    expect(said.limit).toBe(words);
    expect(said.measured).toBe(measured);
    expect(said.limit).not.toMatch(/p\(\d+\)|[<>]|rate|avg/);
  });

  it('says where a limit was measured', () => {
    expect(limitWords(limit({ scope: 'run' })).where).toBe('Whole run');
    expect(limitWords(limit({ scope: 'level:50' })).where).toBe('Level 50');
    expect(limitWords(limit({ scope: 'Level 50' })).where).toBe('Level 50');
  });
});

describe('the result in words', () => {
  it('says why a run broke from its fields, never with the suite’s sentence', () => {
    expect(resultWords(rehearsalBreaks)).toBe(
      'Answers got too slow at 4 users: 95% of them took up to 5.3s, over the 4s limit.',
    );
    const notice = runNotice(rehearsalBreaks)!;
    expect(notice.lead).toBe('Breaks at 4 users.');
    expect(notice.text).toContain('The run stopped by itself after 2m 57s.');
    expect(`${notice.lead} ${notice.text}`).not.toMatch(/VU|latency|Breaks at 4 VUs/);
  });

  it('names the other reasons a level breaks', () => {
    const summary = rehearsalBreaks.summary!;
    const level = { ...summary.levels[1]!, error_pct: 12.5, error_breach: true };
    const as = (reason: 'errors' | 'both') => ({
      ...rehearsalBreaks,
      summary: {
        ...summary,
        headline: { ...summary.headline, breaking_reason: reason },
        levels: [summary.levels[0]!, level, summary.levels[2]!],
      },
    });
    expect(resultWords(as('errors'))).toBe(
      'Too many answers failed at 4 users: 12.5% failed, over the 10% limit.',
    );
    expect(resultWords(as('both'))).toBe(
      'Answers got too slow and too many failed at 4 users: 95% of them took up to 5.3s, over the 4s limit; 12.5% failed, over the 10% limit.',
    );
  });

  it('says what a stopped run found and how much of the hold ran, in whole percent', () => {
    const notice = runNotice(rehearsalStopped)!;
    expect(notice.text).toContain('No level broke a limit up to 2 users.');
    expect(notice.text).toContain('Level 2 ran 38% of its hold.');
    expect(notice.text).not.toContain('configured latency');
  });

  it('lists the limits a failed Smoke or Soak run broke', () => {
    const summary = rehearsalSoak.summary!;
    const failed = {
      ...rehearsalSoak,
      summary: {
        ...summary,
        verdict: 'fail' as const,
        thresholds: summary.thresholds.map((item) =>
          item.metric === 'http_req_failed' ? { ...item, ok: false } : item,
        ),
      },
    };
    expect(resultWords(failed)).toBe('This limit broke: Fewer than 10% of answers fail.');
    expect(runNotice(failed)!.lead).toBe('Failed.');
  });
});

describe('the run page over a real result', () => {
  /** The text of each element that has no child element, so that table cells are not run together. */
  const pageText = () =>
    [...block('content')!.querySelectorAll('*')]
      .filter((element) => !element.children.length)
      .map((element) => element.textContent)
      .join(' | ');

  it('shows a Breakpoint result with no engine text and no unrounded number', async () => {
    setup(rehearsalBreaks);
    expect(await screen.findByTestId('performance-run-notice')).toHaveTextContent(
      'Breaks at 4 users. Answers got too slow at 4 users',
    );
    const rows = within(block('limits')!)
      .getAllByRole('row')
      .map((row) => row.textContent);
    expect(rows.slice(1)).toEqual([
      '95% of answers within 4sWhole run4.7sBroken',
      'Fewer than 10% of answers failWhole run0.0%Kept',
    ]);
    expect(document.querySelector('[data-performance-level-row="4"]')).toHaveTextContent(
      '93% of the hold ran',
    );
    expect(pageText()).not.toMatch(/VU|p\(95\)|rate<|4737\.6|\d\.\d{3,}/);
  });

  it('shows a Soak result with its four limits and a rounded quality', async () => {
    setup(rehearsalSoak);
    expect(await screen.findByTestId('performance-run-notice')).toHaveTextContent(
      /^Passed\. Every limit was kept\./,
    );
    const rows = within(block('limits')!)
      .getAllByRole('row')
      .map((row) => row.textContent);
    expect(rows.slice(1)).toEqual([
      'Fewer than 20% of answers say no data was availableWhole run0.0%Kept',
      'Average quality of the answers above 70 out of 100Whole run97.7Kept',
      'Fewer than 10% of answers failWhole run6.8%Kept',
      '95% of answers within 180sWhole run3.1sKept',
    ]);
    expect(block('numbers')).toHaveTextContent(/Quality.*97\.7/);
    expect(pageText()).not.toMatch(/avg>|rate<|p\(95\)|\d\.\d{3,}/);
  });
});
