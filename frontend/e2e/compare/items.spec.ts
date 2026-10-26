/** Scenarios 5 and 6: expanded items (lazy bodies, trace, copy, score edit) and root-cause issues. */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl, client, seedScenario, urlParams, waitLoaded, goSection, itemDetail } from './support';
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

const card = (page: Page, run: string) => page.locator(`[data-testid="output-card"][data-run="${run}"]`);
const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);

test('expanding an item lazily loads bodies (POST /items/details) and shows a card per run', async ({
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
  await row(page, 'cmp-001')
    .locator('[data-part="item-head"]')
    .click();
  await req;
  const detail = itemDetail(page, 'cmp-001');
  await expect(detail).toBeVisible();
  await expect(detail.getByTestId('output-card')).toHaveCount(4);
  for (const r of [base, a, b, c]) await expect(card(page, r)).toBeVisible();
  await expect(detail).toContainText('Question 1: what does clause 0 of the commerce policy require?');
  await expect(detail).toContainText('Clause 0 requires written approval.'); // expected output
  await expect(card(page, a)).toContainText(/pass/i);
  await expect(card(page, base)).toContainText(/fail/i);
  await expect(card(page, base)).toContainText('Not sure about clause 0.');
  await expect(card(page, base).getByRole('link')).toHaveAttribute('href', /\/runs\/.+\?item=cmp-001/);
  // collapse again
  await row(page, 'cmp-001')
    .locator('[data-part="item-head"]')
    .click();
  await expect(detail).toHaveCount(0);

  // copy button puts the output on the clipboard
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await row(page, 'cmp-001')
    .locator('[data-part="item-head"]')
    .click();
  await card(page, a)
    .getByRole('button', { name: /^Copy output of/ })
    .click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('Clause 0 requires written approval.');
});

test('a task error shows ERROR and the message on the output card', async ({ page }) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a, seed.runs.c]));
  await waitLoaded(page);
  await row(page, 'cmp-005')
    .locator('[data-part="item-head"]')
    .click();
  await expect(card(page, base)).toContainText('ERROR');
  await expect(card(page, base)).toContainText('TimeoutError');
});

test('Trace opens the drawer for a traced item and Escape closes it', async ({ page }) => {
  const { base } = seed.runs;
  await page.goto(compareUrl([traced, base]));
  await waitLoaded(page);
  await row(page, 'cmp-010')
    .locator('[data-part="item-head"]')
    .click();
  await expect(card(page, traced)).toBeVisible();
  await expect(card(page, base)).toBeVisible();
  await expect(card(page, base).getByRole('button', { name: 'Trace' })).toHaveCount(0);
  const trace = card(page, traced).getByRole('button', { name: 'Trace' });
  await expect(trace).toBeVisible();
  const req = page.waitForRequest((r) => /\/items\/cmp-010\/trace/.test(r.url()));
  await trace.click();
  await req;
  const drawer = page.getByTestId('trace-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('answer_question');
  await expect.poll(() => urlParams(page).get('trace')).toBe('cmp-010');
  expect(urlParams(page).get('traceRun')).toBe(traced);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect.poll(() => urlParams(page).get('trace')).toBeNull();
  await expect(trace).toBeFocused();
});

test('edit a score: pencil, Enter saves via POST /api/runs/update_metric and the chip updates', async ({
  page,
}) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  await row(page, 'cmp-002')
    .locator('[data-part="item-head"]')
    .click();
  const chip = card(page, base).locator('[data-metric="quality"]');
  const before = (await chip.innerText()).replace(/\s+/g, ' ');
  await chip.getByRole('button', { name: /^Edit quality score of/ }).click();
  const input = chip.getByRole('textbox', { name: 'New quality score' });
  await expect(input).toBeFocused();
  await input.fill('12%');
  const req = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/runs\/update_metric/.test(r.url()));
  await input.press('Enter');
  const posted = (await req).postDataJSON() as { metric_name: string; new_score: number };
  expect(posted.metric_name).toBe('quality');
  expect(posted.new_score).toBeCloseTo(0.12, 2);
  await expect(chip.getByRole('textbox')).toHaveCount(0);
  await expect(chip).toContainText('12.0%');
  await expect(chip).toContainText('edited');
  expect((await chip.innerText()).replace(/\s+/g, ' ')).not.toBe(before);
  // the row's aggregate is patched too: the editor can reset to the scorer value
  await chip.getByRole('button', { name: /^Edit quality score of/ }).click();
  await chip.getByRole('button', { name: 'Reset to scorer value' }).click();
  await expect(chip).not.toContainText('edited');
});

test('a 422 on save keeps the editor open with the message; Escape cancels', async ({ page }) => {
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
  await row(page, 'cmp-003')
    .locator('[data-part="item-head"]')
    .click();
  const chip = card(page, base).locator('[data-metric="quality"]');
  await chip.getByRole('button', { name: /^Edit quality score of/ }).click();
  await chip.getByRole('textbox', { name: 'New quality score' }).fill('50%');
  await chip.getByRole('button', { name: 'Save' }).click();
  await expect(chip.getByRole('alert')).toContainText('Score must be a valid value');
  await expect(chip.getByRole('textbox', { name: 'New quality score' })).toBeVisible();
  await chip.getByRole('textbox', { name: 'New quality score' }).press('Escape');
  await expect(chip.getByRole('textbox')).toHaveCount(0);
  // client-side validation: an unparsable value never reaches the API
  await chip.getByRole('button', { name: /^Edit quality score of/ }).click();
  await chip.getByRole('textbox', { name: 'New quality score' }).fill('banana');
  await chip.getByRole('button', { name: 'Save' }).click();
  await expect(chip.getByRole('alert')).toBeVisible();
});

test('a locked (submitted) run shows no edit pencil and no Add issue', async ({ page }) => {
  test.skip(!locked, 'POST /v1/runs/{id}/submit was not available in the seed environment');
  const { base } = seed.runs;
  await page.goto(compareUrl([base, locked!]));
  await waitLoaded(page);
  await row(page, 'cmp-002')
    .locator('[data-part="item-head"]')
    .click();
  await expect(card(page, locked!)).toBeVisible();
  await expect(card(page, locked!).getByRole('button', { name: /^Edit .* score of/ })).toHaveCount(0);
  await expect(card(page, locked!).getByRole('button', { name: 'Add issue' })).toHaveCount(0);
  await expect(
    card(page, base)
      .getByRole('button', { name: /^Edit .* score of/ })
      .first(),
  ).toBeVisible();
});

test('root-cause issues: validation, add, show on the card, edit, delete, and filter by the category', async ({
  page,
}) => {
  const { base, a } = seed.runs;
  await page.goto(compareUrl([base, a]));
  await waitLoaded(page);
  await row(page, 'cmp-004')
    .locator('[data-part="item-head"]')
    .click();
  const c = card(page, base);
  await expect(c).toContainText('No root-cause issues assigned.');
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
  await page.getByRole('option', { name: 'New category…' }).click();
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
  await expect(c).not.toContainText('No root-cause issues assigned.');

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
  const cat = page.getByRole('button', { name: /^Hallucination \d+$/ });
  await expect(cat).toBeVisible();
  await cat.click();
  await expect(page.getByTestId('baseline-delta-banner')).toContainText('Root cause: Hallucination');
  await expect(page.getByRole('status').filter({ hasText: /of 40 items/ })).toContainText('1 of 40');
  await page.getByTestId('baseline-delta-banner').getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('status').filter({ hasText: /of 40 items/ })).toContainText('40 of 40');

  // edit then delete
  await c.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog).toContainText('Edit issue');
  await dialog.getByRole('textbox', { name: 'Finding' }).fill('Edited finding');
  await page.getByTestId('issue-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(c).toContainText('Edited finding');
  await c.getByRole('button', { name: 'Edit', exact: true }).click();
  await dialog.getByRole('button', { name: 'Delete issue' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(c).toContainText('No root-cause issues assigned.');
});

test('collapsing an item while its bodies are still loading removes the detail', async ({ page }) => {
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
  await btn.click(); // collapse while "Loading item details…" is shown
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(itemDetail(page, 'cmp-006')).toHaveCount(0);
  await page.waitForTimeout(1200); // let the delayed response land; it must not bring the detail back
  await expect(itemDetail(page, 'cmp-006')).toHaveCount(0);
  expect(urlParams(page).get('item')).toBeNull();
});
