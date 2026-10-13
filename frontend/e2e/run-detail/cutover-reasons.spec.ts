/**
 * Cutover of test_run_page_structure_browser.py (C065 / C068) and the reasons half of
 * test_item_reasons.py: a failing row says why it failed and where that came from, a Fail bar
 * lands on the filtered list with a banner explaining the order, and structured item metadata
 * never renders as "[object Object]".
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

test('every failing row shows its reason and where it came from; passing rows leave the column empty', async ({
  page,
}) => {
  // the Reason column needs a table wider than 760px
  await page.setViewportSize({ width: 1900, height: 1000 });
  await openRun(page, s.slug, runId);
  await showItems(page);
  const expected: Array<[number, string, string]> = [
    [0, 'Expected 12 rows, got 9', 'reason'],
    [2, 'Empty output', 'reason'],
    [4, 'judge 429', 'scorer error'],
    [6, EXPLANATION, 'explanation'],
    [8, 'mismatch', 'label'],
    [10, 'Scored 0.0%, pass needs ≥80%', 'no reason recorded'],
    [12, LONG_REASON, 'reason'],
    [14, 'Provider timeout after final retry', 'task error'],
  ];
  // the reasons the index cannot hold (long text, explanations) are fetched by the page
  for (const [n, text, source] of expected) {
    const cell = row(page, n + 1)
      .locator('td[data-col="reason"] [title]')
      .filter({ hasText: source });
    await expect(cell, `item-${n}`).toBeVisible();
    await expect(cell).toHaveAttribute('title', text);
    await expect(cell).toContainText(text.slice(0, 20));
  }
  for (const n of [1, 3, 5, 7]) {
    const hit = row(page, n + 1)
      .locator('td[data-col="reason"] [title]')
      .filter({ hasText: /reason|scorer error|explanation|label|task error|no reason recorded/ });
    await expect(hit, `item-${n}`).toHaveCount(0);
  }
});

// 8 items score 0; the scorer error and the task error are errors, the other 6 are failures
test('only rows whose reason the index cannot hold are fetched, once, for the displayed metric', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1900, height: 1000 });
  const asked: Array<{ item_ids: string[]; metric: string }> = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith(`/api/runs/${runId}/items/reasons`))
      asked.push(r.postDataJSON() as { item_ids: string[]; metric: string });
  });
  await openRun(page, s.slug, runId);
  await expect(
    row(page, 7).locator('td[data-col="reason"] [title]').filter({ hasText: 'explanation' }),
  ).toBeVisible();
  const ids = new Set(asked.flatMap((a) => a.item_ids));
  // the long reason and the explanation live on the server only; a task error, a scorer error and
  // short reasons come with the index, and passing rows have none
  expect(ids.has('item-6')).toBe(true);
  expect(ids.has('item-12')).toBe(true);
  for (const id of ['item-0', 'item-4', 'item-14', 'item-1', 'item-3']) expect(ids.has(id), id).toBe(false);
  expect(new Set(asked.map((a) => a.metric))).toEqual(new Set(['accuracy']));
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
  await banner.getByRole('button', { name: 'Clear filter' }).click();
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
    .getByRole('button', { name: /^Item 1:/ })
    .first()
    .click();
  // scalars and lists show as badges; the structured value shows as nothing wrong, never as [object Object]
  await expect(page.locator('body')).toContainText('hard');
  await expect(page.locator('body')).toContainText('finance');
  await expect(page.locator('body')).not.toContainText('[object Object]');
});
