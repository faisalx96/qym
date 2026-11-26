// The New run page over a server double: the steps, the checks that turn Start off, the Start dialog, a
// refusal in words, a dataset without kinds, and an upload that becomes the dataset of the run.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  PerformanceDataset,
  PerformanceDatasetTiers,
  PerformanceSetup,
  PerformanceSetupTarget,
} from '@/api/performance';
import { performanceSetup } from '@/features/dev/performanceFixtures';
import { NewRunPage, type NewRunInitial } from '../../../NewRunPage';

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const refusal = (status: number, code: string, message: string, details: unknown = {}) =>
  response({ error: { code, message, details } }, status);

const dataset = (
  id: string,
  name: string,
  counts: [number, number, number],
  over: Partial<PerformanceDataset> = {},
): PerformanceDataset => ({
  id,
  name,
  slug: id,
  latest_published_version: { id: `${id}-v1`, name: 'v1' },
  item_count: counts[0] + counts[1] + counts[2],
  tier_counts: { simple: counts[0], medium: counts[1], complex: counts[2] },
  follow_ups: 0,
  single_kind: false,
  updated_by: 'QA - Person',
  updated_by_user_id: 'user-qa',
  updated_at: '2026-11-12T08:10:00Z',
  ...over,
});

const LOAD = dataset('qa-load', 'QA - Load questions', [30, 38, 71], { follow_ups: 133 });
const DRAFT = dataset('qa-draft', 'QA - Draft questions', [3, 3, 3], { latest_published_version: null });
const COMPLEX = dataset('qa-complex', 'QA - Complex only', [0, 0, 15]);
const PLAIN = dataset('qa-plain', 'QA - Plain questions', [0, 0, 0], { item_count: 12, single_kind: true });

const tiersOf = (item: PerformanceDataset): PerformanceDatasetTiers => ({
  dataset_id: item.id,
  dataset_version_id: item.latest_published_version?.id ?? '',
  version: item.latest_published_version?.name ?? '',
  published: true,
  item_count: item.item_count,
  tier_counts: item.tier_counts,
  untiered: item.single_kind ? item.item_count : 0,
  single_kind: item.single_kind,
  follow_ups: item.follow_ups,
  usable: true,
  reason: null,
});

/** Production with a saved sign-in, which a manager may start on. */
const PRODUCTION: PerformanceSetupTarget = {
  ...performanceSetup.targets.find((target) => target.id === 'target-production')!,
  sign_in_ready: true,
  tokens: [
    {
      name: 'refresh_token',
      hint: '7be2',
      version: 1,
      expires_at: null,
      expired: false,
      updated_at: '2026-11-20T10:58:00Z',
      updated_by: 'QA - Person',
      updated_by_user_id: 'user-qa',
    },
  ],
};

interface Server {
  setup: PerformanceSetup | Response;
  datasets: PerformanceDataset[];
  start: (body: Record<string, unknown>) => Response;
  upload: (form: FormData) => Response | Promise<Response>;
  saveTarget: (id: string, body: Record<string, unknown>) => Response;
}

function RunLanding() {
  return <p>Run page of {useParams().runId}</p>;
}

function renderPage(options: { server?: Partial<Server>; initial?: NewRunInitial } = {}) {
  const server: Server = {
    setup: {
      ...performanceSetup,
      targets: performanceSetup.targets.map((t) => (t.id === PRODUCTION.id ? PRODUCTION : t)),
    },
    datasets: [LOAD, DRAFT, COMPLEX, PLAIN],
    start: () => response({ id: 'run-0025', number: 25, status: 'queued', requested_at: '', plan: {} }, 201),
    upload: () => response({}),
    saveTarget: () => response({}),
    ...options.server,
  };
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const path = url.pathname;
    if (init?.method === 'POST' && path.endsWith('/performance/runs'))
      return server.start(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (init?.method === 'PUT' && /\/performance\/targets\/[^/]+$/.test(path))
      return server.saveTarget(
        decodeURIComponent(path.split('/').pop()!),
        JSON.parse(String(init.body)) as Record<string, unknown>,
      );
    if (init?.method === 'POST' && path.endsWith('/datasets:upload'))
      return server.upload(init.body as FormData);
    if (path.endsWith('/performance/setup'))
      return server.setup instanceof Response ? server.setup.clone() : response(server.setup);
    if (path.endsWith('/performance/datasets')) return response({ datasets: server.datasets });
    if (path.endsWith('/performance/dataset-tiers')) {
      const id = url.searchParams.get('dataset_version_id');
      const item = server.datasets.find((row) => row.latest_published_version?.id === id);
      return item ? response(tiersOf(item)) : refusal(404, 'dataset_version_not_found', 'Not found');
    }
    if (path.endsWith('/v1/datasets/qa-draft/versions'))
      return response({
        dataset: { id: 'qa-draft', name: DRAFT.name },
        versions: [
          { id: 'qa-draft-v1', version: 'v1', status: 'published', created_at: '2026-11-01T08:00:00Z' },
          { id: 'qa-draft-v3', version: 'v3', status: 'draft', created_at: '2026-11-19T08:00:00Z' },
          { id: 'qa-draft-v2', version: 'v2', status: 'draft', created_at: '2026-11-10T08:00:00Z' },
        ],
      });
    if (path.includes('/items'))
      return response({ items: [], metric_names: [], metric_directions: {}, total: 0, next_offset: null });
    return refusal(404, 'not_found', `No route for ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/demo/performance/new']}>
        <Routes>
          <Route
            path="/projects/demo/performance/new"
            element={<NewRunPage slug="demo" initial={options.initial} />}
          />
          <Route path="/projects/demo/performance/runs/:runId" element={<RunLanding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, fetch, server, user: userEvent.setup() };
}

/** The bodies of the start calls. */
const starts = (fetch: ReturnType<typeof renderPage>['fetch']) =>
  fetch.mock.calls
    .filter(([input, init]) => init?.method === 'POST' && String(input).endsWith('/performance/runs'))
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);

const readText = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });

const stepBar = () => document.querySelector<HTMLElement>('[data-performance-block="step-bar"]')!;
const startButton = () => within(stepBar()).getByRole('button', { name: 'Start run' });
/** An option box: the React Aria Radio's label around its (visually hidden) radio input. */
const box = (radio: HTMLElement) => radio.closest('label')!;
/** The tab index of each radio that can be chosen (a disabled one is never focused). */
const tabStops = (radios: HTMLElement[]) =>
  radios.filter((radio) => !(radio as HTMLInputElement).disabled).map((radio) => radio.tabIndex);
const isOff = (button: HTMLElement) =>
  button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';
const checks = () =>
  [...document.querySelectorAll('[data-performance-block="checks"] li')].map(
    (line) => `${line.getAttribute('data-performance-check')}: ${line.textContent}`,
  );

it('walks the five steps, confirms, starts and goes to the run page', async () => {
  const { fetch, user } = renderPage();
  await user.click(await screen.findByRole('radio', { name: /Preprod/ }));
  expect(within(stepBar()).getByRole('button', { name: 'Back' })).toSatisfy(isOff);
  for (const next of ['Test', 'Load', 'Questions', 'Review and start'])
    await user.click(screen.getByRole('button', { name: `Continue to ${next}` }));
  // The first published dataset with questions is the one in use until another is chosen.
  await waitFor(() =>
    expect(checks()).toEqual(['ok: OKEach level is held 7m 30s, long enough to measure a 180s limit.']),
  );
  expect(stepBar()).toHaveTextContent('You will be asked to confirm before anything runs.');

  await user.click(startButton());
  const dialog = await screen.findByRole('dialog', { name: 'Start this run?' });
  expect(within(dialog).queryByRole('textbox')).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: 'Start run' }));

  expect(await screen.findByText('Run page of run-0025')).toBeInTheDocument();
  expect(starts(fetch)).toEqual([
    expect.objectContaining({
      target_id: 'target-preprod',
      test_type: 'breakpoint',
      dataset_version_id: 'qa-load-v1',
      mix: { simple: 50, medium: 35, complex: 15 },
    }),
  ]);
  expect(starts(fetch)[0]).not.toHaveProperty('confirm_target');
});

it('asks for the name of a production target, typed, before it starts', async () => {
  const { fetch, user } = renderPage({ initial: { step: 5, targetId: PRODUCTION.id } });
  await waitFor(() => expect(startButton()).not.toSatisfy(isOff));
  expect(checks()[0]).toBe(
    'warn: WarningThis puts real load on production. You will be asked to type the name of the target.',
  );
  await user.click(startButton());
  const dialog = await screen.findByRole('dialog', { name: 'Start this run on production?' });
  const confirm = within(dialog).getByRole('button', { name: 'Start on production' });
  expect(confirm).toSatisfy(isOff);
  const field = within(dialog).getByRole('textbox', {
    name: /Type the name of the target, Production, to start/,
  });
  await user.type(field, 'production');
  expect(confirm).toSatisfy(isOff);
  await user.clear(field);
  await user.type(field, 'Production');
  expect(confirm).not.toSatisfy(isOff);
  await user.click(confirm);
  expect(await screen.findByText('Run page of run-0025')).toBeInTheDocument();
  expect(starts(fetch)[0]).toMatchObject({ target_id: PRODUCTION.id, confirm_target: 'Production' });
});

it('shows a refusal of the start in words a person can act on, in the dialog and then on the page', async () => {
  const { user } = renderPage({
    initial: { step: 5, targetId: 'target-preprod' },
    server: {
      start: () => refusal(409, 'runner_busy', 'Runner is busy with run 24', { run_id: 'run-0024' }),
    },
  });
  await waitFor(() => expect(startButton()).not.toSatisfy(isOff));
  await user.click(startButton());
  const dialog = await screen.findByRole('dialog', { name: 'Start this run?' });
  await user.click(within(dialog).getByRole('button', { name: 'Start run' }));
  const words =
    'The runner is busy with another run. Wait for that run to end, or stop it, then start again.';
  expect(await within(dialog).findByText(words)).toBeInTheDocument();
  expect(screen.queryByText(/Run page of/)).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('The run was not started.').parentElement).toHaveTextContent(words);
});

it('keeps Start off while a check fails, and never chooses a dataset that is only a draft', async () => {
  const { user } = renderPage({ initial: { step: 4, targetId: 'target-preprod' } });
  const load = await screen.findByRole('radio', { name: /QA - Load questions/ });
  await waitFor(() => expect(load).toBeChecked());

  const draft = screen.getByRole('radio', { name: /QA - Draft questions/ });
  expect(draft).toBeDisabled();
  expect(box(draft)).toHaveTextContent('Draft: publish it in Datasets before a run can use it.');
  // A draft carries the Draft mark (warning dot); a published dataset shows no status word.
  expect(within(box(draft)).getByText('Draft')).toBeInTheDocument();
  expect(box(load)).not.toHaveTextContent('Published');
  await user.click(box(draft));
  expect(load).toBeChecked();

  // The usual mix asks for simple and medium questions; this dataset has only complex ones.
  await user.click(screen.getByRole('radio', { name: /QA - Complex only/ }));
  await user.click(screen.getByRole('button', { name: 'Continue to Review and start' }));
  expect(startButton()).toSatisfy(isOff);
  expect(stepBar()).toHaveTextContent('Start is off until the 2 problems in the checks are fixed.');
  expect(checks().filter((line) => line.startsWith('bad'))).toEqual([
    'bad: ProblemThe mix asks for 50% simple questions, but QA - Complex only has none. Change the mix or the dataset in step 4.',
    'bad: ProblemThe mix asks for 35% medium questions, but QA - Complex only has none. Change the mix or the dataset in step 4.',
  ]);

  // "Change" on Questions goes back to step 4; "Complex only" fixes the mix.
  await user.click(screen.getByRole('button', { name: 'Change questions' }));
  await user.click(screen.getByRole('button', { name: /Ready-made mix/ }));
  await user.click(await screen.findByRole('option', { name: 'Complex only' }));
  await user.click(screen.getByRole('button', { name: 'Continue to Review and start' }));
  expect(startButton()).not.toSatisfy(isOff);
});

it('runs a dataset without kinds as one kind: the mix is not used and the run asks medium questions', async () => {
  const { fetch, user } = renderPage({ initial: { step: 4, targetId: 'target-preprod' } });
  await user.click(await screen.findByRole('radio', { name: /QA - Plain questions/ }));
  expect(
    screen.getByText(
      'This dataset has no kinds: all its questions are asked as one kind, and the mix is not used.',
    ),
  ).toBeInTheDocument();
  for (const slider of screen.getAllByRole('slider')) expect(slider).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Continue to Review and start' }));
  expect(checks()[0]).toBe(
    'warn: WarningQA - Plain questions has no kinds: all its questions are asked as one kind, and the mix is not used.',
  );
  await user.click(startButton());
  const dialog = await screen.findByRole('dialog', { name: 'Start this run?' });
  await user.click(within(dialog).getByRole('button', { name: 'Start run' }));
  await screen.findByText('Run page of run-0025');
  expect(starts(fetch)[0]).toMatchObject({
    dataset_version_id: 'qa-plain-v1',
    mix: { simple: 0, medium: 100, complex: 0 },
  });
});

it('uploads a question file in any structure, saves it as a published dataset and uses it', async () => {
  const saved: { form?: FormData } = {};
  const uploaded = dataset('qa-uploaded', 'QA - Uploaded questions', [1, 1, 1], { follow_ups: 1 });
  const { server, user } = renderPage({
    initial: { step: 4, targetId: 'target-preprod' },
    server: {
      upload: (form) => {
        saved.form = form;
        server.datasets = [uploaded, ...server.datasets];
        return response({
          dataset: { id: 'qa-uploaded', name: 'QA - Uploaded questions' },
          version: { id: 'qa-uploaded-v1', name: 'v1' },
        });
      },
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Upload a file' }));
  const dialog = await screen.findByRole('dialog', { name: 'Upload questions' });
  const file = new File(
    [
      JSON.stringify({
        _instructions: 'Three named lists',
        easy: [{ id: 'e1', question: 'How many rows?', followUpQuestions: [{ question: 'And columns?' }] }],
        normal: [{ id: 'n1', question: 'Top three regions?' }],
        hard: [{ id: 'h1', question: 'Average by level?', mustNotContain: ['no data'] }],
      }),
    ],
    'qa-questions.json',
    { type: 'application/json' },
  );
  await user.upload(within(dialog).getByLabelText('Question file'), file);
  expect(
    await within(dialog).findByText(/3 records in 3 named lists \(easy, normal, hard\)/),
  ).toBeInTheDocument();
  const tiles = within(within(dialog).getByRole('list', { name: 'What the run will get' })).getAllByRole(
    'listitem',
  );
  // Each tile: its label, its number, and what it means (read out, not shown).
  expect(tiles.map((tile) => tile.textContent)).toEqual([
    'Questions3Questions the dataset will hold',
    'Simple1Simple questions',
    'Medium1Medium questions',
    'Complex1Complex questions',
    'Follow-ups1Questions that have a follow-up',
  ]);
  expect(within(dialog).getByText('Every record in the file becomes a question.')).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'Continue to Save' }));
  const name = within(dialog).getByRole('textbox', { name: /Dataset name/ });
  expect(name).toHaveValue('Qa questions');
  await user.clear(name);
  await user.type(name, 'QA - Uploaded questions');
  // A released version shows no status mark (only a draft carries one): the Version line says "The first", no tag.
  const version = within(dialog).getByText('Version').nextElementSibling as HTMLElement;
  expect(version).toHaveTextContent(/^The first$/);
  expect(within(dialog).queryByText('Published')).toBeNull();
  await user.click(within(dialog).getByRole('button', { name: 'Save and use for this run' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(saved.form?.get('name')).toBe('QA - Uploaded questions');
  expect(saved.form?.get('publish')).toBe('true');
  expect(saved.form?.get('create_only')).toBe('true');
  expect(saved.form?.get('format')).toBe('jsonl');
  const lines = (await readText(saved.form?.get('file') as File)).split('\n').map((line) => JSON.parse(line));
  expect(lines).toEqual([
    {
      item_id: 'e1',
      input: 'How many rows?',
      expected_output: null,
      metadata: { tier: 'simple', follow_up: 'And columns?' },
      labels: ['simple'],
    },
    {
      item_id: 'n1',
      input: 'Top three regions?',
      expected_output: null,
      metadata: { tier: 'medium' },
      labels: ['medium'],
    },
    {
      item_id: 'h1',
      input: 'Average by level?',
      expected_output: null,
      metadata: { tier: 'complex', must_not_contain: ['no data'] },
      labels: ['complex'],
    },
  ]);
  expect(await screen.findByRole('radio', { name: /QA - Uploaded questions/ })).toBeChecked();
});

it('says plainly that the area is switched off, without a retry', async () => {
  renderPage({
    server: { setup: refusal(404, 'performance_is_switched_off', 'Performance is switched off') },
  });
  expect(await screen.findByText('Performance tests are switched off')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Try again|Retry/ })).toBeNull();
  expect(document.querySelector('[data-performance-block="step-bar"]')).toBeNull();
});

/** How often the setup was read. */
const setupReads = (fetch: ReturnType<typeof renderPage>['fetch']) =>
  fetch.mock.calls.filter(
    ([input, init]) => (init?.method ?? 'GET') === 'GET' && String(input).endsWith('/performance/setup'),
  ).length;

it('reads the setup again after a start refused because the target changed, and says to check it', async () => {
  const { fetch, user } = renderPage({
    initial: { step: 5, targetId: 'target-preprod' },
    server: {
      start: () => refusal(409, 'target_changed', 'Target changed', { target_id: 'target-preprod' }),
    },
  });
  await waitFor(() => expect(startButton()).not.toSatisfy(isOff));
  const before = setupReads(fetch);
  await user.click(startButton());
  const dialog = await screen.findByRole('dialog', { name: 'Start this run?' });
  await user.click(within(dialog).getByRole('button', { name: 'Start run' }));
  expect(
    await within(dialog).findByText(
      'This target was changed while the run was starting. Check its address and sign-in in step 1, then start again.',
    ),
  ).toBeInTheDocument();
  await waitFor(() => expect(setupReads(fetch)).toBeGreaterThan(before));
});

it('links to the Runner page when the runner uses another key than the chosen one', async () => {
  const blocked = {
    code: 'runner_key_mismatch' as const,
    message: 'The runner connected with another API key than the one chosen for it.',
  };
  renderPage({
    initial: { step: 5, targetId: 'target-preprod' },
    server: { setup: { ...performanceSetup, blocked } },
  });
  const lead = await screen.findByText('A run cannot be started right now.');
  const notice = lead.parentElement!;
  expect(notice).toHaveTextContent(blocked.message);
  expect(within(notice).getByRole('link', { name: 'Runner' })).toHaveAttribute(
    'href',
    '/projects/demo/performance/runner',
  );
  expect(startButton()).toSatisfy(isOff);
  expect(checks()[0]).toBe(`bad: Problem${blocked.message}`);
});

it('says the sign-in must be pasted again after a change that removed it', async () => {
  const preprod = performanceSetup.targets.find((target) => target.id === 'target-preprod')!;
  const { server, user } = renderPage({
    initial: { step: 1, targetId: preprod.id },
    server: {
      saveTarget: (id, body) => {
        const saved = { ...preprod, ...body, id, tokens: [], sign_in_ready: false };
        const setup = server.setup as PerformanceSetup;
        server.setup = { ...setup, targets: setup.targets.map((t) => (t.id === id ? saved : t)) };
        return response(saved);
      },
    },
  });
  await user.click(await screen.findByRole('button', { name: 'Edit target' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit target' });
  const path = within(dialog).getByRole('textbox', { name: 'Sign-in renewal path' });
  await user.clear(path);
  await user.type(path, '/auth/renew');
  expect(
    within(dialog).getByText(
      'The sign-in renewal path changes, so the saved sign-in of this target is cleared. Paste the tokens again after saving.',
    ),
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const lead = await screen.findByText('Sign-in removed.');
  expect(lead.parentElement).toHaveTextContent(
    'The change to Preprod removed its saved sign-in. Paste the tokens again below.',
  );
  expect(screen.getByLabelText(/Refresh token/)).toHaveAttribute('type', 'password');
});

it('makes each group of option boxes one tab stop whose Arrow keys move and choose', async () => {
  const { user } = renderPage({ initial: { step: 1, targetId: 'target-preprod' } });
  const group = await screen.findByRole('radiogroup', { name: 'Target' });
  const radios = within(group).getAllByRole('radio');
  expect(tabStops(radios)).toEqual([-1, -1, 0, -1]);
  radios[2]!.focus();
  await user.keyboard('{ArrowRight}');
  expect(radios[3]).toHaveFocus();
  expect(radios[3]).toBeChecked();
  expect(tabStops(radios)).toEqual([-1, -1, -1, 0]);
  // Round the end, and back.
  await user.keyboard('{ArrowDown}');
  expect(radios[0]).toHaveFocus();
  expect(radios[0]).toBeChecked();
  await user.keyboard('{ArrowUp}');
  expect(radios[3]).toBeChecked();
  // Tab leaves the group in one press: the next stop is "Add a target", not another radio.
  await user.tab();
  expect(document.activeElement).toHaveAttribute('data-performance-target', 'add');

  await user.click(screen.getByRole('button', { name: 'Continue to Test' }));
  const tests = within(screen.getByRole('radiogroup', { name: 'Test' })).getAllByRole('radio');
  expect(tabStops(tests)).toEqual([0, -1, -1]);
  expect(tests[3]).toBeDisabled();
  tests[0]!.focus();
  await user.keyboard('{ArrowLeft}');
  // The disabled "Estishraf dashboards" is skipped.
  expect(tests[2]).toHaveFocus();
  expect(tests[2]).toBeChecked();
});

it('skips a draft in the dataset group, and names the draft’s version', async () => {
  const { user } = renderPage({ initial: { step: 4, targetId: 'target-preprod' } });
  const group = await screen.findByRole('radiogroup', { name: 'Dataset' });
  const radios = within(group).getAllByRole('radio');
  await waitFor(() => expect(radios[0]).toBeChecked());
  expect(tabStops(radios)).toEqual([0, -1, -1]);
  expect(radios[1]).toBeDisabled();
  radios[0]!.focus();
  await user.keyboard('{ArrowRight}');
  expect(radios[2]).toHaveFocus();
  expect(box(radios[2]!)).toHaveTextContent('QA - Complex only');
  expect(radios[2]).toBeChecked();
  // The newest draft names the box that has no published version.
  expect(await within(box(radios[1]!)).findByText('v3')).toBeInTheDocument();
});

it('shows advanced target details and keeps them when renamed from New run', async () => {
  const target = {
    ...PRODUCTION,
    settings: { auth_server: 'https://login.production', refresh_cookie_name: 'production_rt' },
    max_duration_s: 900,
  };
  const { fetch, user } = renderPage({
    initial: { step: 1, targetId: target.id },
    server: {
      setup: { ...performanceSetup, targets: [target] },
      saveTarget: (_id, body) => response({ ...target, ...body }),
    },
  });
  expect(await screen.findByText('https://login.production')).toBeInTheDocument();
  expect(screen.getByText('production_rt')).toBeInTheDocument();
  expect(screen.getByText('Longest run')).toBeInTheDocument();
  expect(screen.getByText('15m')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit target' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(dialog.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'true');
  await user.type(dialog.getByRole('textbox', { name: /^Name/ }), ' renamed');
  await user.click(dialog.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const call = fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
    settings: target.settings,
    max_duration_s: 900,
  });
});
