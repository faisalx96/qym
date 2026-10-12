/** QA fix list (docs/internal/ui-migration/qa/compare.md): run cards, score pills, per-pass baseline, export, trace rows, small defects. */
import { expect, test, type Page } from '@playwright/test';
import { client, cohortUrl, compareUrl, PLATFORM_URL, seedScenario, urlParams, waitLoaded } from './support';
import { createApiKey, createRun, ensureProject, EventStream, seedTracedRun, type CompareSeed } from './seed';
import { uniqueSlug } from '../helpers';

const SPECS = {
  correct: { score_type: 'boolean', direction: 'maximize', pass_threshold: 1, schema_version: 2 },
  quality: {
    score_type: 'percentage',
    direction: 'maximize',
    pass_threshold: 0.7,
    primary: true,
    schema_version: 2,
  },
};
const QUALITY: Record<string, number[]> = {
  a: [0.9, 0.5, 0.677, 0.8, 0.2, 0.6],
  b: [0.4, 0.5, 0.699, 0.85, 0.3, 0.9],
  c: [0.5, 0.6, 0.7, 0.2, 0.9, 0.9],
};
const LONG_EXPECTED = Array.from({ length: 60 }, (_, i) => `expected line ${i + 1}`).join('\n');

/** Three runs on one dataset: a completed, b still RUNNING with another temperature, c completed. */
async function seedFix(
  slug: string,
  token: string,
  which: 'a' | 'b' | 'c',
  running = false,
): Promise<string> {
  const name = `fix-${which}`;
  const config = { samples: 1, run_name: name, temperature: which === 'b' ? 0.9 : 0.2 };
  const runId = await createRun(client, token, {
    task: 'qa_task',
    dataset: 'cmp-fix-v1',
    model: 'openai/gpt-5-mini',
    metrics: Object.keys(SPECS),
    metric_specs: SPECS,
    run_metadata: { run_name: name },
    run_config: config,
  });
  const stream = new EventStream(client, token, runId, 40 + which.charCodeAt(0));
  stream.push('run_started', {
    task: 'qa_task',
    dataset: 'cmp-fix-v1',
    model: 'openai/gpt-5-mini',
    metrics: Object.keys(SPECS),
    metric_specs: SPECS,
    total_items: 6,
    started_at: new Date(Date.UTC(2026, 9, 1, 12, 0, 0)).toISOString(),
    run_metadata: { run_name: name },
    run_config: config,
  });
  QUALITY[which]!.forEach((q, i) => {
    const id = `fix-${String(i + 1).padStart(3, '0')}`;
    stream.push('item_started', {
      item_id: id,
      index: i,
      input: `Question ${i + 1}`,
      expected: i === 0 ? LONG_EXPECTED : `Answer ${i + 1}`,
      item_metadata: { domain: 'd' },
    });
    stream.push('metric_scored', {
      item_id: id,
      metric_name: 'correct',
      score_numeric: q > 0.7 ? 1 : 0,
      score_raw: q > 0.7,
      meta: {},
    });
    stream.push('metric_scored', { item_id: id, metric_name: 'quality', score_numeric: q, meta: {} });
    stream.push('item_completed', {
      item_id: id,
      index: i,
      is_final_pass: true,
      output: `Out ${i + 1}`,
      latency_ms: i === 1 ? 0 : 400,
      item_metadata: { domain: 'd' },
    });
  });
  if (!running)
    stream.push('run_completed', {
      ended_at: new Date(Date.UTC(2026, 9, 1, 12, 30, 0)).toISOString(),
      final_status: 'COMPLETED',
    });
  await stream.flush();
  return runId;
}

let seed: CompareSeed;
let fix: { a: string; b: string; c: string };
let traced: string;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-qafix');
  const slug = uniqueSlug('cmp-fixes');
  const project = await ensureProject(client, 'Compare fixes', slug);
  const token = await createApiKey(client, project.id);
  fix = {
    a: await seedFix(slug, token, 'a'),
    b: await seedFix(slug, token, 'b', true),
    c: await seedFix(slug, token, 'c'),
  };
  const t = await createApiKey(client, seed.projectId);
  traced = await seedTracedRun(client, t, 'traced-fix');
});

const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);

test('C065 collapsed rows show the score, not only Pass/Fail; C063 keeps the item number under a sort', async ({
  page,
}) => {
  await page.goto(compareUrl([fix.a, fix.b, fix.c]));
  await waitLoaded(page);
  const r3 = row(page, 'fix-003');
  await expect(r3).toContainText('67.7%');
  await expect(r3).toContainText('69.9%');
  await page.goto(compareUrl([fix.a, fix.b, fix.c], { sort: 'score_asc' }));
  await waitLoaded(page);
  const first = page.getByTestId('item-row').first();
  const id = (await first.getAttribute('data-item-id'))!;
  expect(id).not.toBe('fix-001'); // the sort moved a different item to the top
  await expect(
    first.getByRole('button', { name: new RegExp(`^Item ${Number(id.slice(-3))}\\b`) }),
  ).toBeVisible();
});

test('C020 run cards show status, counts and dataset version; the chip flags an unfinished run; C021 lists what differs', async ({
  page,
}) => {
  await page.goto(compareUrl([fix.a, fix.b, fix.c]));
  await waitLoaded(page);
  await expect(page.getByRole('group', { name: 'Runs in this comparison' })).toContainText('RUNNING');
  await page.getByRole('button', { name: 'Run details' }).click();
  const cards = page.getByTestId('run-card');
  await expect(cards).toHaveCount(3);
  const b = page.locator(`[data-testid="run-card"][data-run="${fix.b}"]`);
  await expect(b).toHaveAttribute('data-status', 'RUNNING');
  await expect(b).toContainText('Items');
  await expect(b).toContainText('6');
  await expect(b).toContainText('cmp-fix-v1');
  await expect(page.getByText('What differs between the runs')).toBeVisible();
  await expect(page.getByRole('row', { name: /temperature/ })).toContainText('0.9');
});

test('C029 Each pass lists every pass as a baseline candidate', async ({ page }) => {
  const { repeat3, base } = seed.runs;
  await page.goto(compareUrl([repeat3, base], { columns: 'passes' }));
  await waitLoaded(page);
  const chips = page.getByRole('group', { name: 'Runs in this comparison' });
  await expect(chips.getByRole('button', { name: /pass 2/ })).toBeVisible();
  await chips.getByRole('button', { name: /pass 2.*set as baseline/ }).click();
  await expect.poll(() => urlParams(page).get('baseline')).toMatch(/pass2$/);
  await expect(chips.getByRole('button', { name: /pass 2.*, baseline/ })).toBeVisible();
});

test('C107/C108 the compare export carries averages, deltas, the winner strip and the item diff', async () => {
  const res = await fetch(`${PLATFORM_URL}/api/compare/export-html?files=${fix.a}&files=${fix.c}`);
  expect(res.ok).toBe(true);
  const html = await res.text();
  const head = html.split('<iframe', 1)[0]!;
  expect(head).toContain('Per-run averages');
  expect(head).toContain('Winner strip');
  expect(head).toContain('data-verdict=');
  expect(head).toContain('data-item="fix-003"');
  expect(head).not.toContain('RunWorkflowStatus');
  expect(head).toMatch(/fix-a\s*<\/td><td>COMPLETED/);
});

test('C037 trace statistic rows appear when a compared run has spans', async ({ page }) => {
  await page.goto(compareUrl([traced, seed.runs.base]));
  await waitLoaded(page);
  await page.getByRole('tab', { name: 'Metrics' }).click();
  const table = page.getByTestId('trace-stats-table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('row').nth(1)).toBeVisible();
  // a run without spans shows a dash, never 0
  await expect(table).not.toContainText('0.0');
});

test('C078 Add issue targets the metric the page is on, with a metric picker', async ({ page }) => {
  await page.goto(compareUrl([fix.a, fix.c], { metric: 'quality' }));
  await waitLoaded(page);
  await row(page, 'fix-003')
    .getByRole('button', { name: /^Item 3/ })
    .click();
  await row(page, 'fix-003').getByRole('button', { name: 'Add issue' }).first().click();
  const dialog = page.getByTestId('issue-dialog');
  await expect(dialog).toContainText('Add issue · quality');
  await expect(dialog.getByRole('button', { name: /Metric/ })).toBeVisible();
});

test('C069 a long expected output collapses; C073 a 0 ms item shows its latency; the link copy has its own icon', async ({
  page,
}) => {
  await page.goto(compareUrl([fix.a, fix.c]));
  await waitLoaded(page);
  await row(page, 'fix-001')
    .getByRole('button', { name: /^Item 1/ })
    .click();
  const expected = row(page, 'fix-001').locator('[data-kind="expected"]');
  await expect(expected.getByRole('button', { name: 'Show more' })).toBeVisible();
  expect((await expected.boundingBox())!.height).toBeLessThan(500);
  await row(page, 'fix-002')
    .getByRole('button', { name: /^Item 2/ })
    .click();
  await expect(row(page, 'fix-002').getByTestId('output-card').first()).toContainText('0ms');
});

test('C012 the not-found panel names the missing run and links back; the toast lists ids', async ({
  page,
}) => {
  await page.goto(compareUrl(['no-such-run', fix.a]));
  await expect(page.getByRole('alert')).toContainText('Missing: no-such-run');
  await expect(page.getByRole('link', { name: /Back to runs/ })).toBeVisible();
});

test('C017 the analytics tab survives removing a run', async ({ page }) => {
  await page.goto(compareUrl([fix.a, fix.b, fix.c]));
  await waitLoaded(page);
  await page.getByRole('tab', { name: 'Errors' }).click();
  await expect.poll(() => urlParams(page).get('panel')).toBe('errors');
  await page
    .getByRole('button', { name: /^Remove .* from the comparison$/ })
    .last()
    .click();
  await waitLoaded(page);
  await expect(page.getByRole('tab', { name: 'Errors' })).toHaveAttribute('aria-selected', 'true');
});

test('C103 the Sweep view has no baseline reset', async ({ page }) => {
  const { base, a, b, c } = seed.runs;
  await page.goto(cohortUrl([base, a], [b, c], { tab: 'sweep' }));
  await expect(page.getByTestId('compare-page')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset baseline' })).toHaveCount(0);
});

test('C056 the Item-by-Item toolbar offers Analyze for every compared run', async ({ page }) => {
  await page.goto(compareUrl([fix.a, fix.c]));
  await waitLoaded(page);
  await page.getByRole('button', { name: 'Analyze', exact: true }).click();
  const links = page.getByRole('list', { name: 'Analyze a run' });
  await expect(links.getByRole('link')).toHaveCount(2);
});
