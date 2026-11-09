/**
 * Cutover of test_run_page_structure_browser.py (C065 / C068) and the reasons half of
 * test_item_reasons.py: a Fail bar lands on the filtered list with a banner explaining the order, and structured
 * item metadata never renders as "[object Object]". The Items table has no Reason column (C017).
 */
import { test, expect, type Page } from '@playwright/test';
import { compareUrl, waitLoaded } from '../compare/support';
import { PERCENT, seedCustomRun, type CustomItem } from './cutover-support';
import { openRun, seedProject, showItems, type Seeded } from './support';

let s: Seeded;
let runId: string;

const LONG_REASON = 'Result rows differ from the gold rows. '.repeat(10).trim();
const EXPLANATION = 'The query filters on ship_date instead of delivered_date. '.repeat(3).trim();

const pass = (id: string): CustomItem => ({
  id,
  input: `question ${id}`,
  scores: { accuracy: { score: 0.95 } },
});
const items: CustomItem[] = [
  {
    id: 'item-0',
    input: 'question 0',
    scores: { accuracy: { score: 0, meta: { reason: 'Expected 12 rows, got 9' } } },
  },
  pass('item-1'),
  // meta.error without a status is a verdict reason, not a scorer crash (C010)
  { id: 'item-2', input: 'question 2', scores: { accuracy: { score: 0, meta: { error: 'Empty output' } } } },
  pass('item-3'),
  {
    id: 'item-4',
    input: 'question 4',
    scores: { accuracy: { score: 0, meta: { status: 'error', error: 'judge 429' } } },
  },
  pass('item-5'),
  { id: 'item-6', input: 'question 6', scores: { accuracy: { score: 0, explanation: EXPLANATION } } },
  pass('item-7'),
  { id: 'item-8', input: 'question 8', scores: { accuracy: { score: 0, label: 'mismatch' } } },
  pass('item-9'),
  { id: 'item-10', input: 'question 10', scores: { accuracy: { score: 0 } } },
  pass('item-11'),
  { id: 'item-12', input: 'question 12', scores: { accuracy: { score: 0, meta: { reason: LONG_REASON } } } },
  pass('item-13'),
  { id: 'item-14', input: 'question 14', error: 'Provider timeout after final retry' },
  pass('item-15'),
];

test.beforeAll(async () => {
  s = await seedProject('rd-cutover-reasons');
  runId = await seedCustomRun(s, { name: 'reasons', specs: { accuracy: PERCENT }, items });
});

const row = (page: Page, n: number) => page.getByRole('row', { name: new RegExp(`^Open item #${n} `) });

// C017 (review group R2): the owner removed the Reason column completely; the reason stays in the item's details.
test('the Items table has no Reason column, even when it is wide', async ({ page }) => {
  await page.setViewportSize({ width: 1900, height: 1000 });
  await openRun(page, s.slug, runId);
  await showItems(page);
  await expect(row(page, 1)).toBeVisible();
  await expect(page.locator('td[data-col="reason"]')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: /^Reason/ })).toHaveCount(0);
});

// 8 items score 0; the scorer error and the task error are errors, the other 6 are failures
test('the filtered list explains where a reason comes from, and the filter can be cleared', async ({
  page,
}) => {
  await openRun(page, s.slug, runId, 'show=failed&metric=accuracy');
  // settle the lazy sections around the table first: a scroll closes a pinned tooltip
  await showItems(page);
  const banner = page.getByTestId('filter-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Filtered to 6 items that fail accuracy/);
  await banner.getByRole('button', { name: 'How the reason is chosen' }).click();
  await expect(page.getByRole('tooltip')).toContainText(
    'task error → scorer error → reason → explanation → label → no reason recorded',
  );
  await page.keyboard.press('Escape');
  await page.getByTestId('nav-clear-filters').click();
  await expect(banner).toBeHidden();
});

test('structured item metadata never renders as [object Object]', async ({ page }) => {
  const id = await seedCustomRun(s, {
    name: 'metadata',
    specs: { accuracy: PERCENT },
    items: [
      {
        id: 'item-0',
        input: 'question',
        scores: { accuracy: { score: 0.5 } },
        metadata: {
          complexity: 'hard',
          domain: ['finance', { nested: true }],
          provenance: { source: 'import', batch: 3 },
        },
      },
    ],
  });
  await openRun(page, s.slug, id);
  await page.getByRole('button', { name: 'Open item #1', exact: true }).click();
  const card = page.getByTestId('item-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('hard');
  await expect(card).toContainText('finance');
  await expect(card).toContainText('{"source":"import","batch":3}');
  await expect(page.locator('body')).not.toContainText('[object Object]');
});

test('compare: structured item metadata never renders as [object Object]', async ({ page }) => {
  const make = (name: string) =>
    seedCustomRun(s, {
      name,
      specs: { accuracy: PERCENT },
      items: [
        {
          id: 'item-0',
          input: 'question',
          scores: { accuracy: { score: 0.5 } },
          metadata: {
            complexity: 'hard',
            domain: ['finance', { nested: true }],
            provenance: { source: 'import', batch: 3 },
          },
        },
      ],
    });
  const [a, b] = [await make('cmp-meta-a'), await make('cmp-meta-b')];
  await page.goto(compareUrl([a, b]));
  await waitLoaded(page);
  await page
    .getByTestId('item-row')
    .nth(0)
    .locator('[data-part="item-head"]')
    .click();
  // scalars and lists show as badges; the structured value shows as nothing wrong, never as [object Object]
  await expect(page.locator('body')).toContainText('hard');
  await expect(page.locator('body')).toContainText('finance');
  await expect(page.locator('body')).not.toContainText('[object Object]');
});
