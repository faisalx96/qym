import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnvTasksPayload, ServiceTask } from '@/api/launch';
import { DEFAULT_TASK, joinNames, offersTask, taskOptions, TaskCard } from '../entry/TaskCard';
import { createDocument } from '../model';
import { envRecord } from './helpers';
import { live, makeEnv, renderSection } from './sectionTestKit';

/** The Task section (round 9, point 2: one task per experiment). */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const ANSWER: ServiceTask = { id: 'answer-ticket', name: 'Answer a ticket', description: 'Reply from the KB', default: true };
const ROUTE: ServiceTask = { id: 'route-ticket', name: 'Route a ticket', description: null, default: false };

const list = (...tasks: ServiceTask[]): EnvTasksPayload => ({
  environment_id: 'x',
  status: 'ok',
  tasks,
  error: null,
  fetched_at: null,
});

const production = envRecord({ id: 'e1', name: 'production', evaluator_capabilities: { datasets: true, task: true } });
const staging = envRecord({ id: 'e2', name: 'staging', evaluator_capabilities: { datasets: true, task: true } });
const legacy = envRecord({ id: 'e3', name: 'legacy', evaluator_capabilities: { datasets: false, task: false } });

describe('taskOptions', () => {
  it('QR9-C-2-4 Worker default first, then the union by id in order of first appearance', () => {
    const items = taskOptions(
      [production, staging],
      { e1: list(ANSWER), e2: list(ROUTE, ANSWER) },
      null,
    );
    expect(items.map((i) => i.key)).toEqual([DEFAULT_TASK, 'answer-ticket', 'route-ticket']);
    expect(items[1]?.description).toContain('production and staging');
    expect(items[2]?.description).toBe('staging only');
  });

  it('a chosen task no ticked environment lists stays visible', () => {
    const items = taskOptions([production], { e1: list(ANSWER) }, 'gone');
    expect(items.map((i) => i.key)).toEqual([DEFAULT_TASK, 'answer-ticket', 'gone']);
  });

  it('joinNames reads naturally', () => {
    expect(joinNames(['a'])).toBe('a');
    expect(joinNames(['a', 'b'])).toBe('a and b');
    expect(joinNames(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('offersTask', () => {
  it('needs the capability and, when its list was read, the id in it', () => {
    expect(offersTask(legacy, undefined, 'answer-ticket')).toBe(false);
    expect(offersTask(production, list(ANSWER), 'answer-ticket')).toBe(true);
    expect(offersTask(production, list(ANSWER), 'route-ticket')).toBe(false);
    // an unreadable list is unverified, not a refusal (the backend warns)
    expect(offersTask(production, { ...list(), status: 'error' }, 'route-ticket')).toBe(true);
  });
});

afterEach(() => vi.unstubAllGlobals());

function stub() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/e1\/tasks$/.test(url)) return json({ environment_id: 'e1', status: 'ok', tasks: [ANSWER], error: null, fetched_at: null });
      if (/e2\/tasks$/.test(url)) return json({ environment_id: 'e2', status: 'ok', tasks: [ROUTE], error: null, fetched_at: null });
      return json({}, 404);
    }),
  );
}

function mount(ticked: string[], options: Parameters<typeof renderSection>[1] = {}, records = [production, staging, legacy]) {
  stub();
  return renderSection(<TaskCard />, {
    envs: records.map((r) => makeEnv(r.id, r.name)),
    doc: createDocument({ environmentIds: ticked }),
    overrides: {
      envRecords: records,
      selectedEnvs: records.filter((r) => ticked.includes(r.id)),
      ...options.overrides,
    },
    ...options,
  });
}

describe('TaskCard', () => {
  it('QR9-C-2-7 is not rendered when no active environment declares task', () => {
    mount([], {}, [legacy]);
    expect(document.querySelector('[data-part=task-section]')).toBeNull();
  });

  it('QR9-C-2-5 with nothing ticked the select is disabled and says what to do', () => {
    mount([]);
    const section = document.querySelector('[data-part=task-section]') as HTMLElement;
    expect(within(section).getByRole('button', { name: /Task/ })).toBeDisabled();
    expect(section).toHaveTextContent('Pick an environment first');
  });

  it('QR9-C-2-1 one select for any number of ticked environments, choosing sets the one task', async () => {
    mount(['e1', 'e2']);
    const section = document.querySelector('[data-part=task-section]') as HTMLElement;
    await waitFor(() => expect(within(section).getByRole('button', { name: /Task/ })).toBeEnabled());
    expect(within(section).getAllByRole('button', { name: /Task/ })).toHaveLength(1);
    await userEvent.click(within(section).getByRole('button', { name: /Task/ }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Worker default'),
      expect.stringContaining('Answer a ticket'),
      expect.stringContaining('Route a ticket'),
    ]);
    await userEvent.click(await screen.findByRole('option', { name: /Route a ticket/ }));
    expect(live.current!.doc.selection.task).toBe('route-ticket');
  });

  it('QR9-C-2-6 the availability row marks the environment that does not offer the task', async () => {
    mount(['e1', 'e2'], {
      doc: { ...createDocument({ environmentIds: ['e1', 'e2'] }), selection: { ...createDocument().selection, task: 'answer-ticket' } },
    });
    const section = document.querySelector('[data-part=task-section]') as HTMLElement;
    await waitFor(() => expect(section.querySelector('[data-offered=false]')).not.toBeNull());
    expect(section.querySelector('[data-offered=true]')).toHaveTextContent('production');
    expect(section.querySelector('[data-offered=false]')).toHaveTextContent('staging: not offered');
  });

  it('QR9-C-2-8 a cloned per-environment mix is shown read-only', async () => {
    const base = createDocument({ environmentIds: ['e1', 'e2'] });
    mount(['e1', 'e2'], {
      doc: { ...base, selection: { ...base.selection, mixedTasks: { e1: 'answer-ticket', e2: 'route-ticket' } } },
    });
    const section = document.querySelector('[data-part=task-section]') as HTMLElement;
    await waitFor(() => expect(within(section).getByRole('button', { name: /Task/ })).toBeDisabled());
    expect(section).toHaveTextContent('Different per environment');
  });
});
