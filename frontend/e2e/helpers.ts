/**
 * Shared e2e helpers. Seeding goes through the API as dev@local (ADMIN under
 * QYM_AUTH_MODE=none), never by editing the DB.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** The app is served at the platform root; kept so specs can build URLs the same way everywhere. */
export const APP = '';

export interface SeededProject {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export async function createProject(
  request: APIRequestContext,
  name: string,
  slug?: string,
): Promise<SeededProject> {
  const res = await request.post('/v1/projects', { data: { name, slug } });
  if (res.status() === 400 && slug) {
    // already exists from an earlier spec: look it up
    const existing = await request.get(`/v1/projects/by-slug/${encodeURIComponent(slug)}`);
    expect(existing.ok()).toBeTruthy();
    return (await existing.json()) as SeededProject;
  }
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as SeededProject;
}

export async function archiveProject(request: APIRequestContext, projectId: string): Promise<void> {
  const res = await request.post(`/v1/admin/projects/${projectId}/archive`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function unarchiveProject(request: APIRequestContext, projectId: string): Promise<void> {
  const res = await request.post(`/v1/admin/projects/${projectId}/unarchive`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Unique slug per test run so specs never collide. */
export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function gotoApp(page: Page, path = '/'): Promise<void> {
  await page.goto(`${APP}${path === '/' ? '/' : path}`);
}

/** Counts full page loads; assert it stays at 1 for in-app navigation. */
export function trackPageLoads(page: Page): { count: () => number } {
  let loads = 0;
  page.on('load', () => loads++);
  return { count: () => loads };
}

// ── Admin / docs area helpers (area 09) ───────────────────────────────────

export async function createApiKey(request: APIRequestContext, projectId: string): Promise<string> {
  const res = await request.post(`/v1/projects/${projectId}/api-keys`, { data: { name: 'e2e' } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

export interface SeededUser {
  id: string;
  email: string;
  existing?: boolean;
}

export async function createUser(
  request: APIRequestContext,
  email: string,
  displayName = '',
  role: 'ADMIN' | 'MEMBER' = 'MEMBER',
): Promise<SeededUser> {
  const res = await request.post('/v1/admin/users', { data: { email, display_name: displayName, role } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as SeededUser;
}

function runEvent(runId: string, type: string, payload: Record<string, unknown>, sequence: number): string {
  return JSON.stringify({
    schema_version: 1,
    event_id: crypto.randomUUID(),
    sequence,
    sent_at: new Date().toISOString(),
    type,
    run_id: runId,
    payload,
  });
}

export interface SeededRun {
  run_id: string;
  name: string;
}

/**
 * Create a run through the ingest API as the SDK would. `finish: false` leaves it
 * RUNNING (shows under Live Runs with Force stop); otherwise COMPLETED/FAILED.
 */
export async function createRun(
  request: APIRequestContext,
  token: string,
  opts: {
    name: string;
    task?: string;
    dataset?: string;
    model?: string;
    items?: number;
    finish?: boolean;
    fail?: boolean;
  },
): Promise<SeededRun> {
  const {
    name,
    task = 'qa',
    dataset = 'golden',
    model = 'model-a',
    items = 4,
    finish = true,
    fail = false,
  } = opts;
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post('/v1/runs', {
    headers,
    data: { external_run_id: name, task, dataset, model, metrics: ['exact_match'] },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const body = (await created.json()) as { run_id?: string; id?: string };
  const runId = body.run_id ?? body.id!;
  const events: string[] = [
    runEvent(
      runId,
      'run_started',
      { task, dataset, metrics: ['exact_match'], started_at: new Date().toISOString(), total_items: items },
      1,
    ),
  ];
  let seq = 2;
  const done = finish ? items : Math.max(1, Math.floor(items / 2));
  for (let i = 0; i < done; i++) {
    const itemId = `item-${i}`;
    events.push(runEvent(runId, 'item_started', { item_id: itemId, index: i, input: { q: `q${i}` } }, seq++));
    events.push(
      runEvent(
        runId,
        'metric_scored',
        { item_id: itemId, metric_name: 'exact_match', score_numeric: i % 2 },
        seq++,
      ),
    );
    events.push(
      runEvent(runId, 'item_completed', { item_id: itemId, output: `a${i}`, latency_ms: 10 }, seq++),
    );
  }
  if (finish) {
    events.push(
      runEvent(
        runId,
        'run_completed',
        { ended_at: new Date().toISOString(), final_status: fail ? 'FAILED' : 'COMPLETED' },
        seq++,
      ),
    );
  }
  const posted = await request.post(`/v1/runs/${runId}/events`, {
    headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
    data: events.join('\n'),
  });
  expect(posted.ok(), await posted.text()).toBeTruthy();
  return { run_id: runId, name };
}
