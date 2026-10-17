/**
 * Cutover of test_xss_rendering_browser.py (C006 / C013): stored names and run text never become
 * markup on the Runs list, Charts, the run page and Compare. Every user- or SDK-controlled string
 * below carries a payload that runs script when it reaches an HTML sink as markup, and adds a marker
 * attribute when it breaks out of a quoted attribute. The pages must render all of it as text.
 */
import { test, expect, type Page } from '@playwright/test';
import { compareUrl, waitLoaded } from '../compare/support';
import { PERCENT, seedCustomRun } from './cutover-support';
import { openRun, seedProject, type Seeded } from './support';

let s: Seeded;
let runA: string;
let runB: string;

const payload = (tag: string) =>
  `${tag}'"><img src=x data-xss=${tag} onerror=window.__xss=1>" data-xssattr="${tag}' data-xssattr='${tag}`;
const SQL = "SELECT (n * sum_xy - sum_x * sum_y) * 1.0 AS slope FROM t WHERE name LIKE '*a*'";
const PROSE =
  'Answer: **bold** and *soft*. See [docs](https://x.test/" onmouseover="window.__md=1" data-x=").';

async function expectInert(page: Page) {
  const state = await page.evaluate(() => ({
    xss:
      (window as unknown as Record<string, unknown>).__xss ??
      (window as unknown as Record<string, unknown>).__md ??
      null,
    markers: Array.from(document.querySelectorAll('[data-xss], [data-xssattr], [onmouseover]')).map((n) =>
      n.tagName.toLowerCase(),
    ),
  }));
  expect(state).toEqual({ xss: null, markers: [] });
}

async function seedHostile(name: string): Promise<string> {
  return seedCustomRun(s, {
    name: payload(name),
    task: payload('task'),
    dataset: payload('dataset'),
    model: payload('model'),
    specs: { accuracy: PERCENT },
    runMetadata: { git_branch: payload('git_branch'), git_commit: payload('git_commit') },
    items: [0, 1, 2, 3].map((i) => ({
      id: `item-${i}`,
      input: i === 1 ? PROSE : `question ${i}`,
      expected: SQL,
      output: i === 0 ? SQL : PROSE,
      scores: { accuracy: { score: 0.4 } },
    })),
  });
}

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-xss');
  runA = await seedHostile('run_name_a');
  runB = await seedHostile('run_name_b');
});

test('the Runs list renders stored names as text', async ({ page }) => {
  await page.goto(`/projects/${s.slug}`);
  await expect(page.locator('body')).toContainText(payload('task'));
  await expect(page.locator('body')).toContainText(payload('model'));
  await expect(page.locator('body')).toContainText(payload('dataset'));
  await expectInert(page);
});

test('Charts render task, dataset and model names as text', async ({ page }) => {
  await page.goto(`/projects/${s.slug}/charts`);
  await expect(page.locator('body')).toContainText(payload('task'));
  await expect(page.locator('body')).toContainText(payload('dataset'));
  await expectInert(page);
});

test('the run page shows text as stored, with opt-in safe rendering', async ({ page }) => {
  await openRun(page, s.slug, runA);
  // the header chip clips long values to 30 characters; the full stored text is its tooltip (text, never markup)
  await expect(
    page.getByRole('region', { name: 'Run summary' }).locator('[data-chip] > [title]').first(),
  ).toHaveAttribute('title', new RegExp('run_name'));
  await expect(
    page.getByRole('region', { name: 'Run summary' }).locator('[title*="data-xss=run_name_a"]'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Open item #1', exact: true }).click();
  const card = page.locator('[data-testid=item-card][data-item-id="item-0"]');
  await expect(card).toContainText(SQL);
  await expect(card.locator('em, strong')).toHaveCount(0);
  await expectInert(page);
  // Rendered mode: Markdown is a safe subset, links are http(s) only, and SQL is shown as stored.
  await page.getByRole('button', { name: 'Display' }).click();
  await page.getByRole('radio', { name: 'Rendered' }).click({ force: true });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open item #2', exact: true }).click();
  const prose = page.locator('[data-testid=item-card][data-item-id="item-1"]');
  await expect(prose.locator('strong').first()).toHaveText('bold');
  await expect(card).toContainText(SQL);
  await expectInert(page);
});

test('Compare renders run names and outputs as text', async ({ page }) => {
  await page.goto(compareUrl([runA, runB]));
  await waitLoaded(page);
  await page
    .getByRole('button', { name: /^Expand item 1$/ })
    .first()
    .click();
  await expect(page.locator('body')).toContainText(payload('model'));
  await expect(page.locator('body')).toContainText(SQL);
  await expectInert(page);
});
