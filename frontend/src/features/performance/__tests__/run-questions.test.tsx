import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { PerformanceQuestionRow } from '@/api/performance';
import {
  performanceQuestionsPage,
  performanceRunBreakFound,
  performanceRunRunning,
} from '@/features/dev/performanceFixtures';
import { QUESTIONS_PAGE_SIZE, questionResult } from '../components/run/QuestionsTab';
import { reads, setup } from './runHarness';

// The Questions tab: every asked question, newest first, 50 to a page, with filters and the CSV export.
const LIMIT = 180_000;
const first = performanceQuestionsPage.rows[0]!;
const row = (patch: Partial<PerformanceQuestionRow>): PerformanceQuestionRow => ({ ...first, ...patch });

describe('the result of one answer', () => {
  it.each<[string, Partial<PerformanceQuestionRow>, string, string]>([
    ['an answer in time', { status: 'ok', duration_ms: 87_000, no_data: false }, 'success', 'OK'],
    [
      'an answer over the time limit',
      { status: 'ok', duration_ms: 196_000, no_data: false },
      'warning',
      'Slow',
    ],
    [
      'an answer that had no data',
      { status: 'ok', duration_ms: 40_000, no_data: true },
      'neutral',
      'No data',
    ],
    ['a server error', { status: 'error', error_kind: 'server' }, 'danger', 'Server error'],
    ['a timeout', { status: 'error', error_kind: 'network' }, 'danger', 'Timeout'],
    ['a sign-in error', { status: 'error', error_kind: 'auth' }, 'warning', 'Sign-in error'],
    [
      'a refusal for too many requests',
      { status: 'error', error_kind: 'rate_limit' },
      'danger',
      'Rate limit',
    ],
    ['an answer a stop cut off', { status: 'interrupted' }, 'neutral', 'Cut off'],
  ])('%s', (_, patch, tone, word) => {
    expect(questionResult(row(patch), LIMIT)).toEqual([tone, word]);
  });
});

const lastRead = (fetch: ReturnType<typeof setup>['fetch']) => reads(fetch, '/questions').at(-1)!;

it('asks for the first 50 questions and shows them with the nine columns of the design', async () => {
  const { fetch } = setup(performanceRunRunning, { initial: { tab: 'questions' } });
  await waitFor(() =>
    expect(document.querySelectorAll('[data-performance-question]')).toHaveLength(
      performanceQuestionsPage.rows.length,
    ),
  );
  const asked = lastRead(fetch);
  expect(asked.get('page')).toBe('1');
  expect(asked.get('page_size')).toBe(String(QUESTIONS_PAGE_SIZE));
  expect(asked.has('tier')).toBe(false);
  const table = screen.getByRole('treegrid', { name: 'Questions asked' });
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent?.trim())
    .filter(Boolean);
  // The expander first, then the nine columns of the design.
  expect(headers).toEqual([
    'Expand',
    'No.',
    'Answered',
    'Level',
    'Kind',
    'Question',
    'Duration',
    'First byte',
    'Quality',
    'Result',
  ]);
  expect(within(table).getByText(`#${first.seq}`)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: `Show the answer to question ${first.seq}` }),
  ).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'Search questions and answers' })).toBeInTheDocument();
});

it('narrows by kind from the first page, and the export carries the same filters', async () => {
  const user = userEvent.setup();
  const { fetch } = setup(performanceRunRunning, { initial: { tab: 'questions' } });
  await waitFor(() => expect(document.querySelector('[data-performance-question]')).not.toBeNull());
  await user.click(screen.getByRole('button', { name: 'Kind filter' }));
  // Every kind counts while none is picked: taking Complex out leaves the other two.
  await user.click(await screen.findByRole('checkbox', { name: /^Complex/ }));
  await waitFor(() => expect(lastRead(fetch).getAll('tier')).toEqual(['medium', 'simple']));
  expect(lastRead(fetch).get('page')).toBe('1');
  await user.keyboard('{Escape}');

  const csv = new URL(
    screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')!,
    'http://localhost',
  );
  expect(csv.pathname).toBe(
    `/api/projects/demo/performance/runs/${performanceRunRunning.run.id}/questions.csv`,
  );
  expect(csv.searchParams.getAll('tier')).toEqual(['medium', 'simple']);
  expect(csv.searchParams.has('page')).toBe(false);
});

it('opens a row with when, who, the id, and the question and answer in full', async () => {
  const user = userEvent.setup();
  setup(performanceRunBreakFound, { initial: { tab: 'questions' } });
  await waitFor(() => expect(document.querySelector('[data-performance-question]')).not.toBeNull());
  expect(document.querySelector('[data-performance-block="question-detail"]')).toBeNull();
  await user.click(screen.getByRole('button', { name: `Show the answer to question ${first.seq}` }));
  const detail = document.querySelector<HTMLElement>('[data-performance-block="question-detail"]')!;
  for (const label of ['Asked', 'Answered', 'Asked by', 'Question id', 'Question', 'Answer'])
    expect(within(detail).getByText(label)).toBeInTheDocument();
  expect(detail).toHaveTextContent(first.question_id);
  expect(detail).toHaveTextContent(first.question);
});

it('keeps its filters, search and page in the address, with one Clear and the count it narrowed from', async () => {
  const user = userEvent.setup();
  // D7: a view opened from an address reads its filters from it.
  const { fetch } = setup(performanceRunRunning, {
    initial: { tab: 'questions' },
    search: '?kind=complex&result=error&q=revenue&qpage=2',
  });
  await waitFor(() => expect(lastRead(fetch).getAll('tier')).toEqual(['complex']));
  expect(lastRead(fetch).getAll('status')).toEqual(['error']);
  expect(lastRead(fetch).get('q')).toBe('revenue');
  expect(lastRead(fetch).get('page')).toBe('2');
  expect(screen.getByRole('searchbox', { name: 'Search questions and answers' })).toHaveValue('revenue');
  // Two filters and the search: one red Clear 3; the footer says what the list was narrowed from (§3.1).
  const clear = await screen.findByTestId('performance-questions-clear');
  expect(clear).toHaveTextContent('3');
  const all = Object.values(performanceQuestionsPage.facets.statuses).reduce((sum, value) => sum + value, 0);
  expect(await screen.findByText(`Filtered from ${all} questions`)).toBeInTheDocument();
  await user.click(clear);
  await waitFor(() => expect(lastRead(fetch).has('tier')).toBe(false));
  expect(lastRead(fetch).has('status')).toBe(false);
  expect(lastRead(fetch).get('page')).toBe('1');
  expect(screen.queryByTestId('performance-questions-clear')).toBeNull();
  await waitFor(() => expect(screen.queryByText(/^Filtered from/)).toBeNull());
});

it('marks the row of a failed answer', async () => {
  setup(performanceRunRunning, { initial: { tab: 'questions' } });
  await waitFor(() => expect(document.querySelector('[data-performance-question]')).not.toBeNull());
  const failed = performanceQuestionsPage.rows.find((item) => item.status === 'error');
  expect(failed, 'the sample has a failed answer').toBeDefined();
  const tr = document.querySelector(`[data-performance-question="${failed!.seq}"]`)!;
  expect(tr).toHaveAttribute('data-state', 'error');
});

it.each(['#534', '534'])('sends the question number %s to the search and export', async (number) => {
  const user = userEvent.setup();
  const { fetch } = setup(performanceRunRunning, { initial: { tab: 'questions' } });
  await user.type(await screen.findByRole('searchbox', { name: 'Search questions and answers' }), number);
  await waitFor(() => expect(lastRead(fetch).get('q')).toBe(number));
  expect(lastRead(fetch).get('page')).toBe('1');
  const csv = new URL(
    screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href')!,
    'http://localhost',
  );
  expect(csv.searchParams.get('q')).toBe(number);
});
