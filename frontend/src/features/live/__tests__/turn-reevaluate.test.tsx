import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { LiveTurnDetail } from '@/api/live';
import type { LiveActivity } from '@/api/liveWorker';
import {
  liveActivityIdle,
  liveActivityQueued,
  liveActivityReevaluate,
  liveOverview,
  liveTurnDetail,
} from '@/features/dev/liveFixtures';
import { ProjectContext, type ProjectValue } from '@/features/shell/ProjectContext';
import { LiveTurnPage } from '../LiveTurnPage';
import { liveTime } from '../components/turn/presentation';

// Re-evaluating one turn from its page: the request, the five steps while it runs, and how it ends.
const source = liveOverview.status.key;
const turnId = liveTurnDetail.turn.turn_id;
const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const project = (readOnly: boolean) =>
  ({
    project: { name: 'Demo project', slug: 'demo' },
    slug: 'demo',
    readOnly,
    archived: false,
    viewer: readOnly,
    canManage: !readOnly,
    isAdmin: false,
  }) as ProjectValue;
const job = { id: 'job-redo', kind: 'reevaluate', status: 'queued', params: { trace_ids: [turnId] } };
const queued: LiveActivity = {
  ...liveActivityQueued,
  job: { ...liveActivityQueued.job!, id: 'job-redo', kind: 'reevaluate', trace_id: turnId },
};
const active = (status: 'queued' | 'running') => ({
  active: { id: 'job-redo', status, requested_at: '2026-11-03T14:20:00Z', requested_by: 'Ali' },
  last: null,
});

/** A server double: `turn` and `activity` are what the next reads return; POST answers come from `post`. */
function setup(options: { readOnly?: boolean; turn?: LiveTurnDetail; activity?: LiveActivity } = {}) {
  const server = {
    turn: options.turn ?? liveTurnDetail,
    activity: options.activity ?? liveActivityIdle,
    post: () => response(job, 201),
  };
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    if (url.pathname === '/api/dashboard/overview') return response({ chart_data: { modelIndex: {} } });
    if (init?.method === 'POST') return server.post();
    if (url.pathname.endsWith('/worker/activity')) return response(server.activity);
    if (url.pathname.endsWith('/live'))
      return response({ sources: [liveOverview.status], default_source: source });
    return response(server.turn);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectContext.Provider value={project(options.readOnly ?? false)}>
          <LiveTurnPage slug="demo" source={source} turnId={turnId} />
        </ProjectContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  /** The activity line's next poll, without waiting five seconds for it. */
  const poll = () =>
    act(async () => {
      await client.refetchQueries({ queryKey: ['project', 'demo', 'live', 'worker', source, 'activity'] });
    });
  return { ...view, server, fetch, client, poll };
}
const posts = (fetch: ReturnType<typeof setup>['fetch']) =>
  fetch.mock.calls.filter(
    ([input, init]) => init?.method === 'POST' && String(input).includes('/worker/jobs'),
  );

it('hides Re-evaluate from a viewer and from a page with no project around it', async () => {
  setup({ readOnly: true });
  await waitFor(() => expect(document.querySelector('[data-live-question]')).not.toBeNull());
  expect(screen.queryByRole('button', { name: /Re-evaluat/ })).toBeNull();
  expect(document.querySelector('[data-live-block="reevaluation"]')).toBeNull();
});

it('asks for the re-evaluation of this turn and waits for the worker with every step still ahead', async () => {
  const view = setup();
  const user = userEvent.setup();
  const button = await screen.findByRole('button', { name: 'Re-evaluate' });
  const label = document.querySelector('[data-live-block="diagnosis-label"]')!.textContent;
  // The server now knows the job: the turn reports it and the worker has not picked it up.
  view.server.turn = { ...liveTurnDetail, reevaluation: active('queued') };
  view.server.activity = queued;
  await user.click(button);
  const [input, init] = posts(view.fetch)[0]!;
  const url = new URL(input, 'http://localhost');
  expect(url.pathname).toBe('/api/projects/demo/live/worker/jobs');
  expect(url.searchParams.get('source')).toBe(source);
  expect(JSON.parse(String(init!.body))).toEqual({ kind: 'reevaluate', trace_id: turnId });

  const card = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-live-block="reevaluation"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(within(card).getByText('Waiting for the worker')).toBeVisible();
  const steps = await within(card).findAllByRole('listitem');
  expect(steps.map((step) => step.getAttribute('data-state'))).toEqual([
    'next',
    'next',
    'next',
    'next',
    'next',
  ]);
  expect(steps.map((step) => step.firstElementChild!.nextElementSibling!.textContent)).toEqual([
    'Downloading the trace',
    'Checking the chart',
    'Judging',
    'Checking the SQL',
    'Saving the verdict',
  ]);
  expect(screen.getByRole('button', { name: 'Re-evaluating' })).toBeDisabled();
  expect(document.querySelector('[data-live-block="diagnosis-label"]')).toHaveTextContent('Re-evaluating');
  expect(within(card).getByText(/^Previous verdict:/)).toHaveTextContent(
    `Previous verdict: ${label}, ${liveTime(liveTurnDetail.turn.evaluated_at!)}. It stays until the new one is saved.`,
  );
  expect(posts(view.fetch)).toHaveLength(1);
});

it('shows the step the worker reports, then the new verdict with the previous one when the job is gone', async () => {
  const view = setup({
    turn: { ...liveTurnDetail, reevaluation: active('running') },
    activity: liveActivityReevaluate,
  });
  const card = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-live-block="reevaluation"]');
    expect(found).not.toBeNull();
    return found!;
  });
  await within(card).findByText('Step 4 of 5');
  expect(within(card).getByText('Re-evaluating this turn').closest('[data-shape]')).toHaveAttribute(
    'data-shape',
    'orbit',
  );
  const steps = within(card).getAllByRole('listitem');
  expect(steps.map((step) => step.getAttribute('data-state'))).toEqual([
    'done',
    'done',
    'done',
    'now',
    'next',
  ]);
  expect(steps[3]).toHaveAttribute('aria-current', 'step');
  expect(within(steps[3]!).getByText('Now')).toBeVisible();
  expect(within(steps[3]!).getByText('Checking the SQL')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Re-evaluating' })).toBeDisabled();

  // The worker finished: its queue is empty, and the turn carries the new verdict and the one it replaced.
  view.server.activity = liveActivityIdle;
  view.server.turn = {
    ...liveTurnDetail,
    turn: { ...liveTurnDetail.turn, label: 'agent_ok', evaluated_at: '2026-11-03T14:21:00Z' },
    summary: {
      ...liveTurnDetail.summary,
      verdict: { label: 'agent_ok', reason_en: 'The answer matches the result rows.' },
      eval_meta: {
        reevaluated_from: 'run-1',
        previous_verdict: { label: 'agent_problem', evaluated_at: liveTurnDetail.turn.evaluated_at },
      },
    },
    reevaluation: {
      active: null,
      last: { id: 'job-redo', status: 'done', finished_at: '2026-11-03T14:21:00Z', error: null },
    },
  };
  await view.poll();
  await waitFor(() => expect(document.querySelector('[data-live-block="reevaluation"]')).toBeNull());
  expect(await screen.findByRole('button', { name: 'Re-evaluate' })).toBeEnabled();
  expect(document.querySelector('[data-live-block="diagnosis-label"]')).not.toHaveTextContent(
    'Re-evaluating',
  );
  expect(screen.getByText('The answer matches the result rows.')).toBeVisible();
  const previous = document.querySelector('[data-live-block="previous-verdict"]')!;
  expect(previous.textContent).toMatch(/^Previous verdict: .+, /);
  expect(previous).toHaveTextContent(liveTime(liveTurnDetail.turn.evaluated_at!));
  expect(previous).not.toHaveTextContent('It stays until');
});

it('draws the usual order for a queued turn when the worker has reported nothing yet', async () => {
  setup({
    turn: { ...liveTurnDetail, reevaluation: active('queued') },
    // A worker that has never sent its activity: there is no reported order to draw.
    activity: { ...queued, activity: null },
  });
  const card = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-live-block="reevaluation"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(within(card).getByText('Waiting for the worker')).toBeVisible();
  const steps = within(card).getAllByRole('listitem');
  expect(steps.map((step) => step.firstElementChild!.nextElementSibling!.textContent)).toEqual([
    'Downloading the trace',
    'Checking the chart',
    'Judging',
    'Checking the SQL',
    'Saving the verdict',
  ]);
  expect(steps.every((step) => step.getAttribute('data-state') === 'next')).toBe(true);
});

it('says so when a running worker does not report steps, instead of inventing them', async () => {
  setup({
    turn: { ...liveTurnDetail, reevaluation: active('running') },
    activity: { ...queued, activity: null, job: { ...queued.job!, status: 'running' } },
  });
  const card = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-live-block="reevaluation"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(await within(card).findByText('This worker does not report its steps.')).toBeVisible();
  expect(within(card).queryAllByRole('listitem')).toHaveLength(0);
  expect(within(card).getByText('Re-evaluating this turn')).toBeVisible();
});

it('marks the last reported step as stopped when the worker goes silent', async () => {
  setup({
    turn: { ...liveTurnDetail, reevaluation: active('running') },
    activity: {
      ...liveActivityReevaluate,
      server_time: '2026-11-03T14:22:10Z',
      worker: { ...liveActivityReevaluate.worker, stale: true },
    },
  });
  const card = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-live-block="reevaluation"]');
    expect(found).not.toBeNull();
    return found!;
  });
  expect(await within(card).findByText('Stopped here')).toBeVisible();
  expect(within(card).getByText(/^No report from the worker for 2m \d+s$/)).toHaveAttribute(
    'data-tone',
    'warning',
  );
  expect(within(card).getByText('Re-evaluating this turn').closest('[data-shape]')).toHaveAttribute(
    'data-tone',
    'warning',
  );
});

it.each([
  ['failed', 'danger', 'Re-evaluation failed.', 'Langfuse no longer has this trace.'],
  ['cancelled', 'warning', 'Re-evaluation cancelled.', 'ألغيت المهمة قبل اكتمالها.'],
] as const)(
  'says plainly that the re-evaluation %s and keeps the earlier verdict',
  async (status, tone, lead, error) => {
    setup({
      turn: {
        ...liveTurnDetail,
        reevaluation: {
          active: null,
          last: { id: 'job-old', status, finished_at: '2026-11-03T14:21:00Z', error },
        },
      },
    });
    const notice = await screen.findByTestId('reevaluation-last');
    expect(notice).toHaveAttribute('data-tone', tone);
    expect(notice).toHaveTextContent(lead);
    expect(notice).toHaveTextContent(error);
    expect(notice).toHaveTextContent(
      `The verdict below is the earlier one (tried ${liveTime('2026-11-03T14:21:00Z')}).`,
    );
    expect(document.querySelector('[data-live-block="reevaluation"]')).toBeNull();
    expect(document.querySelector('[data-live-block="diagnosis-label"]')).not.toHaveTextContent(
      'Re-evaluating',
    );
    expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeEnabled();
  },
);

it('explains a refusal because another turn is being re-evaluated, and any other refusal in its own words', async () => {
  const view = setup();
  const user = userEvent.setup();
  view.server.post = () => response({ detail: 'A re-evaluation is already queued or running' }, 409);
  await user.click(await screen.findByRole('button', { name: 'Re-evaluate' }));
  const notice = await screen.findByTestId('reevaluation-error');
  expect(notice).toHaveTextContent(
    'A re-evaluation of another turn is already running. Try again when it finishes.',
  );
  expect(document.querySelector('[data-live-block="reevaluation"]')).toBeNull();
  expect(screen.getByRole('button', { name: 'Re-evaluate' })).toBeEnabled();

  view.server.post = () => response({ detail: 'turn not found' }, 404);
  await user.click(screen.getByRole('button', { name: 'Re-evaluate' }));
  await waitFor(() =>
    expect(screen.getByTestId('reevaluation-error')).toHaveTextContent('Couldn’t re-evaluate this turn.'),
  );
});
