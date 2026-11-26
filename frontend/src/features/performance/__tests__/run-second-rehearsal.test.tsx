import { screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { PerformanceRunRead } from '@/api/performance';
import { performanceQuestionsPage, performanceRunInterrupted } from '@/features/dev/performanceFixtures';
import { levelOutcomes } from '../lib/status';
import { runNotice } from '../components/run/words';
import { rehearsal2Broke, rehearsal2Stopped } from './rehearsalReads';
import { block, setup } from './runHarness';

// The second rehearsal's results (see rehearsalReads.ts): a run whose list holds questions that were cut off at the
// end, and a run stopped early in its first hold, whose answers all came back outside a hold.

it('counts every question the list holds, and says why there are more than answers', async () => {
  setup(rehearsal2Broke, {
    initial: { tab: 'questions' },
    server: {
      questions: () => ({
        ...performanceQuestionsPage,
        total: 55,
        facets: { ...performanceQuestionsPage.facets, statuses: { ok: 53, error: 0, interrupted: 2 } },
      }),
    },
  });
  // The loading frame draws the tabs too, with no count: wait for the run itself.
  await screen.findByRole('heading', { name: /^Run \d+$/ });
  expect(screen.getByRole('tab', { name: /Questions/ })).toHaveTextContent('Questions55');
  expect(await screen.findByText(/questions were cut off/)).toHaveTextContent(
    '2 questions were cut off: no answer had come when the run ended.',
  );
  expect(block('numbers')).toHaveTextContent('53 finished in all');
});

it('says no note when nothing was cut off or lost', async () => {
  setup(rehearsal2Broke, { initial: { tab: 'questions' } });
  await screen.findByRole('tab', { name: /Questions/ });
  await screen.findAllByRole('row');
  expect(block('questions-note')).toBeNull();
});

it('says a stopped run had answers, none inside a hold, and that its first hold began', async () => {
  const notice = runNotice(rehearsal2Stopped)!;
  expect(notice.lead).toBe('Stopped.');
  expect(notice.text).toContain(
    '6 answers came back, but none inside a level’s hold, so no level can be judged.',
  );
  expect(notice.text).toContain('Level 2 ran 63% of its hold, with no answer inside it.');
  expect(notice.text).toContain('Levels 4 to 6 were never reached.');
  expect(notice.text).not.toContain('No answer came back');

  expect(levelOutcomes(rehearsal2Stopped)).toEqual({ 2: 'not_finished' });
  setup(rehearsal2Stopped);
  const level2 = await screen.findByText('63% of the hold ran, no answers');
  expect(level2.closest('[data-performance-level-row]')).toHaveTextContent('Not finished');
  expect(document.querySelector('[data-performance-level-row="4"]')).toHaveTextContent('Not reached');
});

it('still says no answer came back when none did', () => {
  const summary = rehearsal2Stopped.summary!;
  const none = {
    ...rehearsal2Stopped,
    summary: { ...summary, headline: { ...summary.headline, answers_total: 0 } },
  };
  expect(runNotice(none)!.text).toContain('No answer came back, so there is nothing to judge.');
});

it('ends another source’s sentence with a full stop before the next one', () => {
  const silent: PerformanceRunRead = {
    ...performanceRunInterrupted,
    status_reason: {
      code: 'runner_silent' as const,
      message: 'The runner stopped reporting at 13:09:00. After 30s of silence the run was ended',
    },
  };
  expect(runNotice(silent)!.text).toContain('the run was ended. What it reported until then is shown below.');
});
