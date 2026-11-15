import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import {
  liveWorkerRead,
  liveWorkerPending,
  liveWorkerFailed,
  liveWorkerLegacy,
} from '@/features/dev/liveFixtures';
import { setup, writes, openField, refetchWorker, response } from './workerHarness';

// Live worker page: saving settings, drafts, versions and worker actions.
vi.mock('@/features/shell/ProjectContext', () => ({
  useProjectContext: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
  useOptionalProject: () => ({ project: { name: 'Demo project' }, slug: 'demo' }),
}));

it.each([
  ['2026-11-04', '2026-11-04', 'Nov 4'],
  ['2026-11-03', '2026-11-04', 'Nov 3 – Nov 4'],
])('shows readable job days %s to %s', async (since_day, until_day, label) => {
  const job = liveWorkerRead.jobs[0]!;
  setup({ ...liveWorkerRead, jobs: [{ ...job, params: { ...job.params, since_day, until_day } }] });
  expect(within(await screen.findByRole('grid', { name: 'Worker jobs' })).getByText(label)).toBeVisible();
});
it.each([
  [liveWorkerPending, 'Pending'],
  [liveWorkerFailed, 'Failed'],
] as const)('shows verification state %#', async (read, status) => {
  setup(read);
  expect((await screen.findAllByText(status)).length).toBeGreaterThan(0);
  if (status === 'Failed') expect(screen.getByText(/could not translate host name/)).toBeVisible();
});
it('posts values, only the typed secret and note, then clears secrets and toasts the version', async () => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'new-secret');
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Rotate Langfuse');
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  expect(await screen.findByText('Saved as version 4')).toBeVisible();
  const [url, init] = writes(fetch)[0]!;
  expect(new URL(url, 'http://localhost').pathname).toBe('/api/projects/demo/live/worker/settings');
  expect(init?.method).toBe('POST');
  expect(JSON.parse(String(init?.body))).toEqual({
    values: liveWorkerRead.settings!.values,
    secrets: { langfuse_secret_key: 'new-secret' },
    note: 'Rotate Langfuse',
  });
  expect(screen.getByLabelText('Langfuse secret key')).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
});
it('preserves the draft on a new version and loads it only when requested', async () => {
  const view = setup();
  const user = userEvent.setup();
  const host = await openField('Database', 'Database host');
  await user.clear(host);
  await user.type(host, 'draft.example.com');
  await user.type(await openField('Langfuse', 'Langfuse secret key'), 'draft-secret');
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'Draft note');
  await refetchWorker(view, liveWorkerPending);
  expect(await screen.findByText('Version 4 was saved by Ali while you were editing')).toBeVisible();
  expect(screen.getByLabelText('Database host')).toHaveValue('draft.example.com');
  expect(screen.getByLabelText('Langfuse secret key')).toHaveValue('draft-secret');
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Draft note');
  await user.click(screen.getByRole('button', { name: 'Load version 4' }));
  expect(screen.getByLabelText('Database host')).toHaveValue(
    liveWorkerPending.settings!.values.database.host,
  );
  expect(screen.getByLabelText('Langfuse secret key')).toHaveValue('');
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
  expect(screen.queryByText(/while you were editing/)).toBeNull();
});
it.each(['Langfuse secret key', 'Note'])('keeps a draft with only %s changed', async (label) => {
  const view = setup();
  const user = userEvent.setup();
  await user.type(
    await (label === 'Note' ? screen.findByRole('textbox', { name: 'Note' }) : openField('Langfuse', label)),
    'Draft',
  );
  await refetchWorker(view, liveWorkerPending);
  expect(await screen.findByText('Version 4 was saved by Ali while you were editing')).toBeVisible();
  expect(screen.getByLabelText(label, { selector: 'input' })).toHaveValue('Draft');
  await user.click(screen.getByRole('button', { name: 'Keep my draft' }));
  expect(screen.queryByText(/while you were editing/)).toBeNull();
  await refetchWorker(view, { ...liveWorkerPending, stale: true });
  expect(screen.queryByText(/while you were editing/)).toBeNull();
  expect(screen.getByLabelText(label, { selector: 'input' })).toHaveValue('Draft');
});
it('loads a new version silently when the form is not dirty', async () => {
  const view = setup();
  await openField('Database', 'Database host');
  await refetchWorker(view, liveWorkerPending);
  await waitFor(() =>
    expect(screen.getByLabelText('Database host')).toHaveValue(
      liveWorkerPending.settings!.values.database.host,
    ),
  );
  expect(screen.queryByText(/while you were editing/)).toBeNull();
});
it('reinitialises the form after saving so the next version loads silently', async () => {
  const view = setup(liveWorkerRead, () => {
    view.setRead(liveWorkerPending);
    return response({ version: 4 });
  });
  const user = userEvent.setup();
  const host = await openField('Database', 'Database host');
  await user.clear(host);
  await user.type(host, liveWorkerPending.settings!.values.database.host);
  await user.type(screen.getByRole('textbox', { name: 'Note' }), 'New host');
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  expect(await screen.findByText('Saved as version 4')).toBeVisible();
  expect(screen.queryByText(/while you were editing/)).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
  await refetchWorker(view, {
    ...liveWorkerRead,
    settings: { ...liveWorkerRead.settings!, version: 5 },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Database host')).toHaveValue(liveWorkerRead.settings!.values.database.host),
  );
  expect(screen.queryByText(/while you were editing/)).toBeNull();
});
it('scrolls to problems after the worker data loads for a hash link', async () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  try {
    setup(liveWorkerRead, undefined, ['/projects/demo/live/worker?source=worker#problems']);
    await screen.findByRole('button', { name: 'Save as v4' });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
    expect(scrollIntoView.mock.contexts).toContain(document.getElementById('problems'));
  } finally {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});
it('keeps the route and query and scrolls when the strip problems link is clicked', async () => {
  const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  try {
    const route = '/projects/demo/live/worker?source=worker+%26+prod&view=all';
    setup(liveWorkerRead, undefined, [route]);
    const link = await screen.findByRole('link', { name: '19 problems in the last hour' });
    expect(link).toHaveAttribute('href', `${route}#problems`);
    await userEvent.setup().click(link);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }));
    expect(scrollIntoView.mock.contexts).toContain(document.getElementById('problems'));
  } finally {
    if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});
it('confirms restoring version 2 and posts the restore endpoint', async () => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await screen.findByRole('button', { name: 'Save as v4' });
  const row = screen.getByText('v2').closest('li')!;
  await user.click(within(row).getByRole('button', { name: 'Restore' }));
  expect(screen.getByRole('dialog', { name: 'Restore version 2?' })).toBeVisible();
  expect(writes(fetch)).toHaveLength(0);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }));
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(writes(fetch)[0]![0]).toContain('/settings/2/restore?source=');
});
it('confirms pausing, then PUTs paused', async () => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Pause evaluation' }));
  expect(screen.getByRole('dialog', { name: 'Pause evaluation?' })).toBeVisible();
  expect(writes(fetch)).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Pause' }));
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(writes(fetch)[0]![1]?.method).toBe('PUT');
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({ state: 'paused' });
});
it('PUTs the selected worker key', async () => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /Worker key/ }));
  await user.click(screen.getByRole('option', { name: /Replacement worker/ }));
  await waitFor(() => expect(writes(fetch)).toHaveLength(1));
  expect(writes(fetch)[0]![0]).toContain('/key?source=');
  expect(writes(fetch)[0]![1]?.method).toBe('PUT');
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body))).toEqual({ api_key_id: 'key-next' });
});

it.each([false, true])('saves enabled evaluator traces with a typed secret: %s', async (typed) => {
  const { fetch } = setup();
  const user = userEvent.setup();
  await user.click(await openField('Evaluator traces', 'Send evaluator traces'));
  const section = within(screen.getByRole('region', { name: 'Evaluator traces' }));
  fireEvent.change(section.getByLabelText('Langfuse host'), { target: { value: 'https://traces.test' } });
  fireEvent.change(section.getByLabelText('Public key'), { target: { value: 'pk-traces' } });
  if (typed) fireEvent.change(section.getByLabelText('Secret key'), { target: { value: 'sk-traces' } });
  expect(section.getByRole('button')).toHaveTextContent(
    `https://traces.test · secret ${typed ? 'set' : 'not set'}`,
  );
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  await screen.findByText('Saved as version 4');
  const payload = JSON.parse(String(writes(fetch)[0]![1]?.body));
  expect(payload.values.evaluator_traces).toEqual({
    enabled: true,
    host: 'https://traces.test',
    public_key: 'pk-traces',
  });
  expect(payload.secrets).toEqual(typed ? { evaluator_traces_secret_key: 'sk-traces' } : undefined);
  expect(section.getByLabelText('Secret key')).toHaveValue('');
});

it('switches evaluator traces off and omits a newly typed secret', async () => {
  const read = structuredClone(liveWorkerRead);
  Object.assign(read.settings!.values, {
    evaluator_traces: { enabled: true, host: 'https://traces.test', public_key: 'pk-traces' },
  });
  const { fetch } = setup(read);
  const user = userEvent.setup();
  fireEvent.change(await openField('Evaluator traces', 'Secret key'), { target: { value: 'discard-me' } });
  await user.click(screen.getByRole('switch', { name: 'Send evaluator traces' }));
  const section = within(screen.getByRole('region', { name: 'Evaluator traces' }));
  for (const label of ['Langfuse host', 'Public key', 'Secret key'])
    expect(section.getByLabelText(label)).toBeDisabled();
  expect(section.getByRole('button')).toHaveTextContent('Off');
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  await screen.findByText('Saved as version 4');
  const payload = JSON.parse(String(writes(fetch)[0]![1]?.body));
  expect(payload.values.evaluator_traces.enabled).toBe(false);
  expect(payload.secrets).toBeUndefined();
});

it('renders an old stored version without changes and saves it with disabled evaluator traces', async () => {
  const { fetch } = setup(liveWorkerLegacy);
  const user = userEvent.setup();
  expect(await screen.findByRole('button', { name: 'Save as v4' })).toBeDisabled();
  expect(await openField('Evaluator traces', 'Send evaluator traces')).not.toBeChecked();
  expect(screen.queryByText('Unsaved changes')).toBeNull();
  await user.click(await openField('Evaluation', 'Chart vision'));
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  await screen.findByText('Saved as version 4');
  expect(JSON.parse(String(writes(fetch)[0]![1]?.body)).values.evaluator_traces).toEqual({
    enabled: false,
    host: '',
    public_key: '',
  });
});

it.each([false, true])('compares an old worker with evaluator traces enabled: %s', async (enabled) => {
  const read = structuredClone(liveWorkerRead);
  read.running!.running = { ...read.running!.running! };
  Reflect.deleteProperty(read.running!.running, 'evaluator_traces');
  Object.assign(read.settings!.values, {
    evaluator_traces: { enabled, host: 'https://traces.test', public_key: 'pk-traces' },
  });
  setup(read);
  const section = await screen.findByRole('region', { name: 'Evaluator traces' });
  const trigger = within(section).getByRole('button');
  expect(trigger).toHaveAttribute('aria-expanded', String(enabled));
  if (enabled) expect(trigger).toHaveTextContent('differs from running v3');
  else expect(trigger).not.toHaveTextContent('differs from running');
  expect(screen.getByRole('button', { name: 'Save as v4' })).toBeDisabled();
});

it.each([
  ['values', 'evaluator_traces', 'host', 'Langfuse host'],
  ['values', 'evaluator_traces', 'public_key', 'Public key'],
  ['secrets', 'evaluator_traces_secret_key', 'Secret key'],
])('scopes evaluator traces validation errors: %s %s %s', async (...pathAndLabel) => {
  const label = pathAndLabel.pop()!;
  setup(liveWorkerRead, () =>
    response({ detail: [{ loc: ['body', ...pathAndLabel], msg: 'Trace field is invalid' }] }, 422),
  );
  const user = userEvent.setup();
  await user.click(await openField('Evaluator traces', 'Send evaluator traces'));
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  const section = within(screen.getByRole('region', { name: 'Evaluator traces' }));
  await waitFor(() => expect(section.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true'));
  expect(section.getByLabelText(label)).toHaveAccessibleDescription(/Trace field is invalid/);
  expect(await openField('Langfuse', 'Langfuse host')).not.toHaveAttribute('aria-invalid', 'true');
  expect(
    within(screen.getByRole('region', { name: 'Langfuse' })).getByLabelText('Public key'),
  ).not.toHaveAttribute('aria-invalid', 'true');
});

it('loads a newer legacy version without treating the default section as a draft', async () => {
  const view = setup(liveWorkerLegacy);
  await screen.findByRole('button', { name: 'Save as v4' });
  await refetchWorker(view, { ...liveWorkerLegacy, settings: { ...liveWorkerLegacy.settings!, version: 4 } });
  expect(await screen.findByRole('button', { name: 'Save as v5' })).toBeDisabled();
  expect(screen.queryByText(/while you were editing/)).toBeNull();
  expect(await openField('Evaluator traces', 'Send evaluator traces')).not.toBeChecked();
});

it('keeps a stored evaluator trace secret write-only when switching off', async () => {
  const read = structuredClone(liveWorkerRead);
  read.settings!.values.evaluator_traces = {
    enabled: true,
    host: 'https://traces.test',
    public_key: 'pk-traces',
  };
  read.settings!.secret_hints.evaluator_traces_secret_key = '1234';
  const { fetch } = setup(read);
  const user = userEvent.setup();
  expect(await openField('Evaluator traces', 'Secret key')).toHaveValue('');
  const section = within(screen.getByRole('region', { name: 'Evaluator traces' }));
  expect(section.getByRole('button')).toHaveTextContent('https://traces.test · secret set');
  expect(section.getByLabelText('Secret key')).toHaveAccessibleDescription('set, ends in …1234');
  await user.click(section.getByRole('switch', { name: 'Send evaluator traces' }));
  await user.click(screen.getByRole('button', { name: 'Save as v4' }));
  await screen.findByText('Saved as version 4');
  const payload = JSON.parse(String(writes(fetch)[0]![1]?.body));
  expect(payload.values.evaluator_traces.enabled).toBe(false);
  expect(payload.secrets).toBeUndefined();
});
