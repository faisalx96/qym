import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvTask } from '../entry/TaskRow';
import { EnvVersions } from '../entry/VersionsBlock';
import { createDocument } from '../model';
import { envRecord } from './helpers';
import { live, makeEnv, renderSection } from './sectionTestKit';

/** The task row inside a ticked environment's box (QD-30 to QD-39). */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TASKS = [
  { id: 'answer-ticket', name: 'Answer a ticket', description: 'Reply from the KB', default: true },
  { id: 'route-ticket', name: 'Route a ticket', description: null, default: false },
];

let tasksPayload: unknown = { status: 'ok', tasks: TASKS, error: null };
let tasksCalls = 0;
let delay: Promise<void> | null = null;

function stub() {
  tasksCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/tasks$/.test(url)) {
        tasksCalls += 1;
        if (delay) await delay;
        return json({ environment_id: 'e1', fetched_at: null, ...(tasksPayload as object) });
      }
      if (/versioning-details$/.test(url))
        return json({ environment_id: 'e1', status: 'ok', versioning_details: {}, error: null, fetched_at: null });
      return json({}, 404);
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  tasksPayload = { status: 'ok', tasks: TASKS, error: null };
  delay = null;
});

const withTask = envRecord({ name: 'staging', evaluator_capabilities: { datasets: true, task: true } });
const withoutTask = envRecord({ name: 'staging', evaluator_capabilities: { datasets: false, task: false } });
const line = () => document.querySelector('[data-env-task="e1"]') as HTMLElement | null;

function mount(env = withTask, options: Parameters<typeof renderSection>[1] = {}) {
  stub();
  return renderSection(<EnvTask env={env} projectId="p1" />, {
    envs: [makeEnv('e1', 'staging')],
    doc: createDocument({ environmentIds: ['e1'] }),
    ...options,
  });
}

describe('EnvTask', () => {
  it('QD-31 an environment whose schema has no task has no row and issues no request', async () => {
    mount(withoutTask);
    await new Promise((r) => setTimeout(r, 30));
    expect(line()).toBeNull();
    expect(tasksCalls).toBe(0);
  });

  it('QD-30/QD-32 lists Worker default first, then the tasks with their descriptions', async () => {
    mount();
    await waitFor(() => expect(line()?.getAttribute('data-status')).toBe('ok'));
    expect(within(line()!).getByText('Task')).toBeInTheDocument();
    const trigger = within(line()!).getByRole('button', { name: /Task of staging/ });
    expect(trigger).toHaveTextContent('Worker default');
    await userEvent.click(trigger);
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Worker default',
      'Answer a ticketReply from the KB',
      'Route a ticket',
    ]);
  });

  it('QD-38 choosing a task is part of the document, per environment', async () => {
    mount();
    await waitFor(() => expect(line()?.getAttribute('data-status')).toBe('ok'));
    await userEvent.click(within(line()!).getByRole('button', { name: /Task of staging/ }));
    await userEvent.click(await screen.findByRole('option', { name: /Route a ticket/ }));
    expect(live.current!.doc.selection.tasks).toEqual({ e1: 'route-ticket' });
    expect(within(line()!).getByRole('button', { name: /Task of staging/ })).toHaveTextContent('Route a ticket');
    await userEvent.click(within(line()!).getByRole('button', { name: /Task of staging/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Worker default' }));
    expect(live.current!.doc.selection.tasks).toEqual({});
  });

  it('QD-33 while reading it keeps the row height with a placeholder and a hidden status', async () => {
    let release!: () => void;
    delay = new Promise((r) => {
      release = r;
    });
    mount();
    expect(line()?.getAttribute('data-status')).toBe('loading');
    expect(within(line()!).getByRole('status')).toHaveTextContent('Reading tasks…');
    expect(line()!.querySelector('[aria-hidden="true"]')).not.toBeNull();
    release();
    await waitFor(() => expect(line()?.getAttribute('data-status')).toBe('ok'));
  });

  it('QD-34 an empty list is a disabled select that says so', async () => {
    tasksPayload = { status: 'ok', tasks: [], error: null };
    mount();
    await waitFor(() => expect(line()?.getAttribute('data-status')).toBe('ok'));
    const trigger = within(line()!).getByRole('button', { name: /Task of staging/ });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('No tasks listed');
  });

  it('QD-35 an error shows the reason and keeps the row', async () => {
    tasksPayload = { status: 'error', tasks: [], error: 'could not list tasks: registry offline' };
    mount();
    await waitFor(() => expect(line()?.getAttribute('data-status')).toBe('error'));
    expect(line()).toHaveTextContent('Couldn’t read tasks: could not list tasks: registry offline');
  });

  it('QD-36 a service that answers unsupported has no row and no error', async () => {
    tasksPayload = { status: 'unsupported', tasks: [], error: null };
    mount();
    await waitFor(() => expect(tasksCalls).toBe(1));
    await waitFor(() => expect(line()).toBeNull());
    expect(document.body).not.toHaveTextContent('Couldn’t read tasks');
  });

  it('QD-37 an archived project shows the value but cannot change it', async () => {
    mount(withTask, {
      doc: { ...createDocument({ environmentIds: ['e1'] }), selection: { extraRefs: [], more: [], runShape: 'combined', tasks: { e1: 'route-ticket' } } },
      overrides: { readOnly: true },
    });
    await waitFor(() => expect(line()?.getAttribute('data-status')).toBe('ok'));
    const trigger = within(line()!).getByRole('button', { name: /Task of staging/ });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent('Route a ticket');
  });

  it('QD-39 Refresh reads versions and tasks, and is named for both when the row exists', async () => {
    stub();
    renderSection(
      <>
        <EnvVersions env={withTask} projectId="p1" />
        <EnvTask env={withTask} projectId="p1" />
      </>,
      { envs: [makeEnv('e1', 'staging')], doc: createDocument({ environmentIds: ['e1'] }) },
    );
    await waitFor(() => expect(line()?.getAttribute('data-status')).toBe('ok'));
    expect(tasksCalls).toBe(1);
    const refresh = screen.getByRole('button', { name: 'Refresh versions and tasks of staging' });
    await userEvent.click(refresh);
    await waitFor(() => expect(tasksCalls).toBe(2));
  });

  it('QD-39 without the row the button keeps its name', async () => {
    stub();
    renderSection(<EnvVersions env={withoutTask} projectId="p1" />, {
      envs: [makeEnv('e1', 'staging')],
      doc: createDocument({ environmentIds: ['e1'] }),
    });
    expect(await screen.findByRole('button', { name: 'Refresh versions of staging' })).toBeInTheDocument();
    expect(tasksCalls).toBe(0);
  });
});
