/** Scenarios 5 and 6: the item pane (lazy bodies, trace, copy, score edit) and root-cause issues. */
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  closeItem,
  compareUrl,
  client,
  seedScenario,
  urlParams,
  waitLoaded,
  goSection,
  itemDetail,
  openItem,
  paneMetrics,
  paneOutputs,
} from './support';
import { createApiKey, seedCompareRun, seedTracedRun, type CompareSeed } from './seed';

let seed: CompareSeed;
let traced: string;
let locked: string | null = null;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-item');
  const token = await createApiKey(client, seed.projectId);
  traced = await seedTracedRun(client, token, 'traced');
  // a run whose scores are locked (SUBMITTED)
  const l = await seedCompareRun(client, token, {
    name: 'locked',
    model: 'openai/gpt-5-mini',
    skill: 0,
    items: 12,
    seed: 9,
  });
  const res = await fetch(`${client.baseUrl}/v1/runs/${l}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  locked = res.ok ? l : null;
});

const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);
/**
 * The pane has no element for one run. What belongs to a run is found by the position of the run in the URL
 * (0 = the first run): its output block, its cell in a metric row, its block of root-cause issues.
 */
const out = (pane: Locator, run: number) => paneOutputs(pane).nth(run);
const metricCell = (pane: Locator, metric: string, run: number) =>
  paneMetrics(pane)
    .getByRole('row')
    .filter({ has: pane.page().getByRole('rowheader', { name: new RegExp(`^${metric}\\b`) }) })
    .getByRole('cell')
    .nth(run);
const issues = (pane: Locator, run: number) =>
  pane.getByRole('region', { name: /^Root-cause issues for / }).nth(run);

test('opening an item lazily loads bodies (POST /items/details) and shows an output block per run', async ({
  page,
  context,
}) => {
  const { base, a, b, c } = seed.runs;
  const details: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/items\/details/.test(r.url())) details.push(r.url());
  });
  await page.goto(compareUrl([base, a, b, c]));
  await waitLoaded(page);
  expect(details).toHaveLength(0); // the compact snapshot carries no bodies
  const req = page.waitForRequest((r) => r.method() === 'POST' && /\/items\/details/.test(r.url()));
  await row(page, 'cmp-001').locator('[data-part="item-head"]').click();
  await req;
  const detail = itemDetail(page, 'cmp-001');
  await expect(detail).toBeVisible();
  await expect(paneOutputs(detail)).toHaveCount(4);
  await expect(detail.locator('section[data-part="input"]')).toContainText(
    'Question 1: what does clause 0 of the commerce policy require?',
  );
  await expect(detail.locator('section[data-part="expected"]')).toContainText(
    'Clause 0 requires written approval.',
  );
  // runs in the order of the URL: base = 0, a = 1
  await expect(out(detail, 1)).toContainText(/pass/i);
  await expect(out(detail, 1)).toHaveAttribute('data-tone', 'success');
  await expect(out(detail, 0)).toContainText(/fail/i);
  await expect(out(detail, 0)).toHaveAttribute('data-tone', 'danger');
  await expect(out(detail, 0)).toContainText('Not sure about clause 0.');
  // the run name of an output is the link to this item in that run
  await expect(out(detail, 0).locator('a[data-link="name"]')).toHaveAttribute(
    'href',
    new RegExp(`/runs/${base}\\?item=cmp-001`),
  );
  // close again
  await closeItem(page);

  // the copy tile puts the output on the clipboard
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const again = await openItem(page, 'cmp-001', 4);
  await out(again, 1)
    .getByRole('button', { name: /^Copy the output of / })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('Clause 0 requires written approval.');
});

test('a task error shows "Task error" and the message in the output block of the run', async ({ page }) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a, seed.runs.c]));
  await waitLoaded(page);
  const pane = await openItem(page, 'cmp-005', 3);
  await expect(out(pane, 0)).toHaveAttribute('data-tone', 'danger');
  await expect(out(pane, 0)).toContainText('Task error');
  await expect(out(pane, 0).getByRole('note')).toContainText('The task failed before it gave an output');
  await expect(out(pane, 0).getByRole('note')).toContainText('TimeoutError');
});

test('the Open trace tile opens the drawer for a traced item and Escape closes it; the pane stays', async ({
  page,
}) => {
  const { base } = seed.runs;
  await page.goto(compareUrl([traced, base]));
  await waitLoaded(page);
  const pane = await openItem(page, 'cmp-010', 2);
  // a run with no trace keeps the tile, disabled (its reason is the tooltip)
  await expect(out(pane, 1).getByRole('button', { name: /^Open the trace of / })).toBeDisabled();
  const trace = out(pane, 0).getByRole('button', { name: /^Open the trace of / });
  await expect(trace).toBeEnabled();
  const req = page.waitForRequest((r) => /\/items\/cmp-010\/trace/.test(r.url()));
  await trace.click();
  await req;
  const drawer = page.getByTestId('trace-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('answer_question');
  // "Open in Langfuse" is no longer supported
  await expect(page.getByRole('link', { name: /Langfuse/ })).toHaveCount(0);
  await expect.poll(() => urlParams(page).get('trace')).toBe('cmp-010');
  expect(urlParams(page).get('traceRun')).toBe(traced);
  // Escape closes the drawer only: the pane stays and the tile has the focus again
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect.poll(() => urlParams(page).get('trace')).toBeNull();
  await expect(pane).toBeVisible();
  await expect(trace).toBeFocused();
});

test('edit a score: pencil, Enter saves via POST /api/runs/update_metric and the cell updates', async ({
  page,
}) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  const pane = await openItem(page, 'cmp-002', 2);
  const cell = metricCell(pane, 'quality', 0);
  const before = (await cell.innerText()).replace(/\s+/g, ' ');
  await cell.getByRole('button', { name: /^Edit the quality score of / }).click();
  await expect(cell).toHaveAttribute('data-editing', '');
  const input = cell.getByRole('textbox', { name: 'New quality score' });
  await expect(input).toBeFocused();
  await input.fill('12%');
  const req = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/runs\/update_metric/.test(r.url()));
  await input.press('Enter');
  const posted = (await req).postDataJSON() as { metric_name: string; new_score: number };
  expect(posted.metric_name).toBe('quality');
  expect(posted.new_score).toBeCloseTo(0.12, 2);
  await expect(cell.getByRole('textbox')).toHaveCount(0);
  await expect(cell).toContainText('12.0%');
  await expect(cell).toContainText('edited');
  expect((await cell.innerText()).replace(/\s+/g, ' ')).not.toBe(before);
  // the row's aggregate is patched too: the editor can reset to the scorer value
  await cell.getByRole('button', { name: /^Edit the quality score of / }).click();
  await cell.getByRole('button', { name: 'Reset to scorer value' }).click();
  await expect(cell).not.toContainText('edited');
});

test('a 422 on save keeps the editor open with the message; Escape cancels and the pane stays', async ({
  page,
}) => {
  const { base, a } = seed.runs;
  await page.route('**/api/runs/update_metric', (r) =>
    r.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Score must be a valid value' }),
    }),
  );
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  const pane = await openItem(page, 'cmp-003', 2);
  const cell = metricCell(pane, 'quality', 0);
  await cell.getByRole('button', { name: /^Edit the quality score of / }).click();
  await cell.getByRole('textbox', { name: 'New quality score' }).fill('50%');
  await cell.getByRole('button', { name: 'Save' }).click();
  await expect(cell.getByRole('alert')).toContainText('Score must be a valid value');
  await expect(cell.getByRole('textbox', { name: 'New quality score' })).toBeVisible();
  // Escape in the field belongs to the editor: it does not close the pane
  await cell.getByRole('textbox', { name: 'New quality score' }).press('Escape');
  await expect(cell.getByRole('textbox')).toHaveCount(0);
  await expect(pane).toBeVisible();
  // client-side validation: an unparsable value never reaches the API
  await cell.getByRole('button', { name: /^Edit the quality score of / }).click();
  await cell.getByRole('textbox', { name: 'New quality score' }).fill('banana');
  await cell.getByRole('button', { name: 'Save' }).click();
  await expect(cell.getByRole('alert')).toBeVisible();
});

test('a locked (submitted) run shows no edit pencil and no Add issue', async ({ page }) => {
  test.skip(!locked, 'POST /v1/runs/{id}/submit was not available in the seed environment');
  const { base } = seed.runs;
  await page.goto(compareUrl([base, locked!]));
  await waitLoaded(page);
  // base = 0, the locked run = 1
  const pane = await openItem(page, 'cmp-002', 2);
  await expect(metricCell(pane, 'quality', 1)).toBeVisible();
  for (const metric of ['correct', 'quality'])
    await expect(
      metricCell(pane, metric, 1).getByRole('button', { name: /^Edit the .* score of / }),
    ).toHaveCount(0);
  await expect(issues(pane, 1)).toBeVisible();
  await expect(issues(pane, 1).getByRole('button', { name: 'Add issue' })).toHaveCount(0);
  await expect(
    metricCell(pane, 'quality', 0).getByRole('button', { name: /^Edit the .* score of / }),
  ).toBeVisible();
  await expect(issues(pane, 0).getByRole('button', { name: 'Add issue' })).toBeVisible();
});

test('root-cause issues: validation, add, show in the pane, edit, delete, and filter by the category', async ({
  page,
}) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  let pane = await openItem(page, 'cmp-004', 2);
  let c = issues(pane, 0);
  await expect(c).toContainText('No root-cause issues assigned');
  await c.getByRole('button', { name: 'Add issue' }).click();
  const dialog = page.getByTestId('issue-dialog');
  await expect(dialog).toBeVisible();
  // no category -> validation message, nothing posted
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && /update_root_cause_issue/.test(r.url())) posts++;
  });
  await page.getByTestId('issue-save').click();
  await expect(dialog.getByRole('alert')).toContainText('Choose or type a category.');
  expect(posts).toBe(0);
  // valid: new category + finding
  await dialog.getByRole('button', { name: /Category/ }).click();
  await page.getByRole('option', { name: 'New category' }).click();
  await dialog.getByRole('textbox', { name: 'New category' }).fill('Hallucination');
  await dialog.getByRole('textbox', { name: 'Finding' }).fill('Invented a clause number');
  const req = page.waitForRequest((r) => r.method() === 'POST' && /update_root_cause_issue/.test(r.url()));
  await page.getByTestId('issue-save').click();
  const body = (await req).postDataJSON() as {
    action: string;
    metric_name: string;
    issue: { category: string; finding: string };
  };
  expect(body.action).toBe('add');
  expect(body.issue).toMatchObject({ category: 'Hallucination', finding: 'Invented a clause number' });
  await expect(dialog).toHaveCount(0);
  await expect(c).toContainText('Hallucination');
  await expect(c).toContainText('Invented a clause number');
  await expect(c).not.toContainText('No root-cause issues assigned');
  // the pane lies over the report sections: close it before the steps on the page
  await closeItem(page);

  // an analysis now exists: the Items head offers Auto-analyze for every compared run
  await page.getByRole('button', { name: 'Auto-analyze' }).click();
  const popover = page.getByRole('dialog', { name: 'Auto-analyze runs' });
  await expect(popover.getByRole('link')).toHaveCount(2);
  // one run per line inside its own surface
  const outer = (await popover.boundingBox())!;
  const tops = new Set<number>();
  for (let i = 0; i < 2; i++) {
    const bb = (await popover.getByRole('link').nth(i).boundingBox())!;
    tops.add(Math.round(bb.y));
    expect(bb.x).toBeGreaterThanOrEqual(outer.x);
    expect(bb.x + bb.width).toBeLessThanOrEqual(outer.x + outer.width);
  }
  expect(tops.size).toBe(2);
  expect(await popover.getByRole('list').evaluate((e) => getComputedStyle(e).listStyleType)).toBe('none');
  await page.keyboard.press('Escape');

  // Root cause tab now lists the category; pressing it filters the items
  await goSection(page, 'Root cause');
  const cat = page.locator('[data-part="root-cause-card"]').filter({ hasText: 'Hallucination' });
  await expect(cat).toBeVisible();
  await cat.click();
  await expect(page.getByTestId('baseline-delta-banner')).toContainText('Root cause: Hallucination');
  await expect(page.getByRole('status').filter({ hasText: /of 40 items/ })).toContainText('1 of 40');
  await page.locator('[data-part="items-clear-btn"]').click(); // K6: the one Clear is in the sticky nav
  await expect(page.getByRole('status').filter({ hasText: /of 40 items/ })).toContainText('40 of 40');

  // edit then delete, in the pane again
  await goSection(page, 'Items');
  pane = await openItem(page, 'cmp-004', 2);
  c = issues(pane, 0);
  await c.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog).toContainText('Edit issue');
  await dialog.getByRole('textbox', { name: 'Finding' }).fill('Edited finding');
  await page.getByTestId('issue-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(c).toContainText('Edited finding');
  await c.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete issue' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(c).toContainText('No root-cause issues assigned');
});

test('closing an item while its bodies are still loading removes the pane', async ({ page }) => {
  const { base, a } = seed.runs;
  await page.route('**/items/details', async (route) => {
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  const btn = row(page, 'cmp-006').locator('[data-part="item-head"]');
  await btn.click();
  await expect(itemDetail(page, 'cmp-006')).toBeVisible();
  await expect(btn).toHaveAttribute('aria-current', 'true');
  // close while the loading frame is shown: a second click on the start of the row (the pane covers the rest)
  await btn.click({ position: { x: 24, y: 16 } });
  await expect(btn).not.toHaveAttribute('aria-current');
  await expect(itemDetail(page, 'cmp-006')).toHaveCount(0);
  await page.waitForTimeout(1200); // let the delayed response land; it must not bring the pane back
  await expect(itemDetail(page, 'cmp-006')).toHaveCount(0);
  expect(urlParams(page).get('item')).toBeNull();
});
