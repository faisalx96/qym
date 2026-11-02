/** §8.10: the exact legacy ?list= context a run link carries, and the neighbors endpoint it feeds. */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { dataRows, openRuns, sharedProject } from './support';

const ORDER = [
  'range',
  'from',
  'to',
  'task',
  'model',
  'dataset',
  'status',
  'version',
  'owner',
  'origin',
  'q',
  'sort',
];
const FILTER_KEYS: Record<string, string> = {
  task: 'tasks',
  model: 'models',
  dataset: 'datasets',
  status: 'statuses',
  version: 'versions',
  owner: 'users',
};

/** Decode a context the way run_order.js / the run page does into a /api/dashboard/neighbors body. */
function bodyFromContext(slug: string, runId: string, context: string, collation?: string[]) {
  const p = new URLSearchParams(context);
  const filters: Record<string, unknown> = {};
  for (const [param, field] of Object.entries(FILTER_KEYS)) {
    let values = p.getAll(param);
    if (param === 'model')
      values = values.flatMap((v) =>
        /\|\|\|(plain|reasoning)$/.test(v) ? [v] : [`${v}|||plain`, `${v}|||reasoning`],
      );
    filters[field] = values;
  }
  const range = p.get('range');
  if (range === 'week' || range === 'month')
    filters.since = new Date(Date.now() - (range === 'week' ? 7 : 30) * 86_400_000).toISOString();
  if (p.get('origin')) filters.origins = [p.get('origin')];
  if (p.get('q')) filters.q = p.get('q');
  return {
    project_slug: slug,
    run_id: runId,
    filters,
    sort: p.get('sort') ?? 'time-desc',
    ...(collation ? { collation } : {}),
  };
}

async function neighbors(request: APIRequestContext, body: Record<string, unknown>) {
  let res = await request.post('/api/dashboard/neighbors', { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
  let json = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (json.collation_needed) {
    const collation = [...(json.sort_values as string[])].sort((a, b) => a.localeCompare(b));
    res = await request.post('/api/dashboard/neighbors', { data: { ...body, collation } });
    json = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  return json;
}

test.describe('run link list context (§8.10)', () => {
  test('keys appear in the legacy order, page is never carried, defaults are omitted', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    // URL params deliberately in a different order than the context order
    await openRuns(
      page,
      s.project.slug,
      'sort=task-asc&q=a&origin=local&status=COMPLETED&status=FAILED&task=summarize&task=text2sql&range=month&page=1',
    );
    const link = dataRows(page).first().locator('td[data-col="run"] a');
    const href = (await link.getAttribute('href'))!;
    const context = new URL(href, 'http://x').searchParams.get('list')!;
    expect(context).toBe(
      'range=month&task=summarize&task=text2sql&status=COMPLETED&status=FAILED&origin=local&q=a&sort=task-asc',
    );
    const keys = [...new URLSearchParams(context).keys()];
    const positions = keys.map((k) => ORDER.indexOf(k));
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(keys).not.toContain('page');
    // default view: no ?list= at all
    await openRuns(page, s.project.slug);
    const plain = (await dataRows(page).first().locator('td[data-col="run"] a').getAttribute('href'))!;
    expect(plain).not.toContain('list=');
  });

  test('custom range and model filters are encoded as the legacy page does', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(
      page,
      s.project.slug,
      'range=custom&from=2020-01-01&to=2031-12-31&model=gpt-4o&sort=time-asc',
    );
    const href = (await dataRows(page).first().locator('td[data-col="run"] a').getAttribute('href'))!;
    const context = new URL(href, 'http://x').searchParams.get('list')!;
    expect(context).toBe('range=custom&from=2020-01-01&to=2031-12-31&model=gpt-4o&sort=time-asc');
  });

  test('POST /api/dashboard/neighbors with the decoded context answers from the list order', async ({
    page,
    request,
  }) => {
    const s = await sharedProject(request, 12);
    // numeric/time sort: no collation
    await openRuns(page, s.project.slug, 'status=COMPLETED&sort=time-asc');
    const rows = dataRows(page);
    const n = await rows.count();
    expect(n).toBeGreaterThan(2);
    const second = rows.nth(1).locator('td[data-col="run"] a');
    const href = (await second.getAttribute('href'))!;
    const runId = decodeURIComponent(href.split('/runs/')[1]!.split('?')[0]!);
    const context = new URL(href, 'http://x').searchParams.get('list')!;
    const body = bodyFromContext(s.project.slug, runId, context);
    const res = await neighbors(request, body);
    expect(res.context).toBe('list');
    expect(res.position).toBe(2);
    expect(res.total).toBe(n);
    // the list's own neighbours: row 1 is the previous, row 3 the next
    const idOf = async (i: number) => (await rows.nth(i).getAttribute('data-run-id'))!;
    expect(res.previous.run_id).toBe(await idOf(0));
    expect(res.next.run_id).toBe(await idOf(2));
    // text sort: needs the collation round trip
    await openRuns(page, s.project.slug, 'task=summarize&task=text2sql&sort=model-desc');
    const link = dataRows(page).nth(1).locator('td[data-col="run"] a');
    const h2 = (await link.getAttribute('href'))!;
    const id2 = decodeURIComponent(h2.split('/runs/')[1]!.split('?')[0]!);
    const ctx2 = new URL(h2, 'http://x').searchParams.get('list')!;
    expect(ctx2).toBe('task=summarize&task=text2sql&sort=model-desc');
    const res2 = await neighbors(request, bodyFromContext(s.project.slug, id2, ctx2));
    expect(['list', 'default']).toContain(res2.context);
    expect(res2.previous ?? res2.next).toBeTruthy();
  });

  test('the run page opened from a filtered list keeps ?list= in its URL', async ({ page, request }) => {
    const s = await sharedProject(request, 12);
    await openRuns(page, s.project.slug, 'task=rag-qa&sort=task-asc');
    await dataRows(page).first().locator('td[data-col="run"] a').click();
    await expect(page).toHaveURL(/\/runs\/.+\?list=task%3Drag-qa%26sort%3Dtask-asc$/);
  });
});
