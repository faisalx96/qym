/** Round 9 (create) e2e helpers: two environments that both offer tasks, an experiment with a sweep to review, measuring. */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import {
  createEnvironment,
  FAKE_A,
  FAKE_B,
  launchExperiment,
  publishDefaultPreset,
  seedProject,
  setFakeCapabilities,
  setFakeTasks,
  type Seeded,
  type SeededEnv,
} from '../support';
import { createVersionedDataset } from './multiSupport';

export interface R9Fixture extends Seeded {
  /** FAKE_A: tasks answer-ticket, route-ticket, summarise-ticket; `max_priority` HIGH. */
  production: SeededEnv;
  /** FAKE_B: only answer-ticket; `max_priority` NORMAL. */
  staging: SeededEnv;
}

export const ANSWER = { id: 'answer-ticket', name: 'Answer a ticket', description: 'Reply from the knowledge base', default: true };
export const ROUTE = { id: 'route-ticket', name: 'Route a ticket', description: null, default: false };
export const SUMMARISE = { id: 'summarise-ticket', name: 'Summarise a ticket', description: null, default: false };

/**
 * Project with datasets, `production` on FAKE_A (three tasks, High allowed) and `staging` on FAKE_B (one task, capped at
 * Normal), both v1.4, each with a default preset that holds no dataset.
 */
export async function seedR9(request: APIRequestContext, opts: { tasks?: boolean } = {}): Promise<R9Fixture> {
  const tasks = opts.tasks ?? true;
  const s = await seedProject(request, 'r9');
  await createVersionedDataset(request, s.project.slug, 'support-tickets', 3);
  await createVersionedDataset(request, s.project.slug, 'billing-faq', 2);
  await setFakeCapabilities(request, FAKE_A, { datasets: true, task: tasks });
  await setFakeCapabilities(request, FAKE_B, { datasets: true, task: tasks });
  if (tasks) {
    await setFakeTasks(request, FAKE_A, { tasks: [ANSWER, ROUTE, SUMMARISE] });
    await setFakeTasks(request, FAKE_B, { tasks: [ANSWER] });
  }
  const production = await createEnvironment(request, s.project.id, 'production', { port: FAKE_A, maxPriority: 'HIGH' });
  const staging = await createEnvironment(request, s.project.id, 'staging', { port: FAKE_B, maxPriority: 'NORMAL' });
  const spec = {
    evaluator: { config: { samples: 1 } },
    slot_bindings: { 'endpoint:primary': { connection_id: s.connectionId } },
    env_overrides: {},
  };
  for (const env of [production, staging]) await publishDefaultPreset(request, s.project.id, env.id, spec);
  return { ...s, production, staging };
}

/** An experiment with a 3-value timeout sweep on both environments (6 runs): the clone page reviews it. */
export async function launchSweep(request: APIRequestContext, f: R9Fixture, task?: string) {
  return launchExperiment(request, f.project.id, {
    name: 'timeout sweep',
    environment_ids: [f.production.id, f.staging.id],
    spec: {
      evaluator: { dataset: 'support-tickets', dataset_version: 'v3', ...(task ? { task } : {}), config: { samples: 1 } },
      slot_bindings: { 'endpoint:primary': { connection_id: f.connectionId } },
      env_overrides: { LLM_OVERRIDES: { endpoints: { primary: { timeout: { sweep: [10, 30, 60] } } } } },
    },
  });
}

export const cloneUrl = (slug: string, id: string, step?: string) =>
  `/projects/${slug}/experiments/new?clone=${id}${step ? `&step=${step}` : ''}`;

export const bar = (page: Page): Locator => page.locator('[data-part=launch-bar]');
export const part = (page: Page, name: string): Locator => page.locator(`[data-part=${name}]`);
export const taskSection = (page: Page): Locator => part(page, 'task-section');
export const taskSelect = (page: Page): Locator => part(page, 'task-select').getByRole('button', { name: /Task/ });
export const envBox = (page: Page, name: string): Locator =>
  page.locator('[data-part=env-box]').filter({ has: page.getByRole('checkbox', { name }) });

export const near = (actual: number, expected: number, tolerance: number, what = '') =>
  expect(Math.abs(actual - expected), `${what} ${actual} vs ${expected} ± ${tolerance}`).toBeLessThanOrEqual(tolerance);

export async function box(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await l.page().evaluate(() => document.fonts.ready);
  const b = await l.boundingBox();
  expect(b, 'element has a box').toBeTruthy();
  return b!;
}

/** Computed style of an element (resolved colours are rgb()). */
export function computed(l: Locator, props: string[]): Promise<Record<string, string>> {
  return l.evaluate((el, names) => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n)]));
  }, props);
}

/** The resolved colour of a token (e.g. `--bg-elevated`) as `rgb(r, g, b)`. */
export function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${t})`;
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);
}

/** Relative luminance contrast of two `rgb()`/`rgba()` strings. */
export function contrast(a: string, b: string): number {
  const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const lum = (c: string) => {
    const [r, g, bl] = parse(c) as [number, number, number];
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
