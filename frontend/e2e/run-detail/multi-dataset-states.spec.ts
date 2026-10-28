/// <reference lib="dom" />
/** Multi-dataset round, WP-C (spec-c.md 4.6): a single-dataset run is today's page; a deleted dataset; twelve datasets. */
import { test, expect, type Page } from '@playwright/test';
import { client } from './support';
import { manyEntries, seedUnionRun, type UnionRun } from './unionSeed';

let single: UnionRun;
let deleted: UnionRun;
let many: UnionRun;
const stamp = Date.now().toString(36);

test.beforeAll(async () => {
  test.setTimeout(180_000);
  single = await seedUnionRun(client, {
    slug: `md-single-${stamp}`,
    name: 'ticket-triage-nightly',
    entries: [{ name: 'support-tickets', items: 60, errors: 1, means: [0.66, 0.84, 0.77] }],
  });
  deleted = await seedUnionRun(client, { slug: `md-del-${stamp}`, deleteAfter: ['billing-faq'] });
  many = await seedUnionRun(client, {
    slug: `md-many2-${stamp}`,
    name: 'nightly-all-sets',
    entries: manyEntries(),
  });
});

const url = (s: UnionRun) => `/projects/${s.slug}/runs/${s.runId}`;
async function open(page: Page, width: number, to: string) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(to);
  await expect(page.getByTestId('run-hero')).toBeVisible();
  await expect(page.getByTestId('items-count')).toBeVisible();
}

test('QC-U41: a one-dataset run is exactly today’s page', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await open(page, 1440, url(single));
  // fact label, tag and no Datasets group, nav entry, section, column or filter
  await expect(page.locator('[data-testid=run-hero-strip] dt', { hasText: /^Dataset$/ })).toHaveCount(1);
  await expect(page.locator('[data-testid=run-hero-strip] dt', { hasText: /^Datasets$/ })).toHaveCount(0);
  await expect(page.getByTestId('hero-dataset-chip')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Datasets' })).toHaveCount(0);
  await expect(page.locator('[data-section="datasets"]')).toHaveCount(0);
  await expect(page.locator('#run-section-datasets')).toHaveCount(0);
  await expect(page.getByTestId('dataset-filter')).toHaveCount(0);
  const sections = await page.locator('[data-report-section]').evaluateAll((els) => els.map((e) => e.id));
  expect(sections).not.toContain('run-section-datasets');
  await page.locator('#run-items').scrollIntoViewIfNeeded();
  await expect(page.getByRole('columnheader', { name: 'Dataset' })).toHaveCount(0);
  // the count line is today’s "n of m items"
  await expect(page.getByTestId('items-count')).toHaveText(/^60 of 60 items$/);
  // no breakdown request
  expect(requests.filter((u) => /\/api\/runs\/[^/]+\/datasets/.test(u))).toEqual([]);
});

test('QC-U43: a dataset deleted after the run keeps its chip and its row, without a link', async ({
  page,
}) => {
  await open(page, 1440, url(deleted));
  const chips = page.getByTestId('hero-dataset-chip');
  await expect(chips).toHaveCount(3);
  const gone = chips.nth(2);
  await expect(gone).toContainText('billing-faq');
  await expect(gone).toContainText('deleted');
  expect(await gone.evaluate((e) => e.tagName)).toBe('SPAN');
  await expect(gone).not.toHaveAttribute('href', /.*/);
  expect(await chips.first().evaluate((e) => e.tagName)).toBe('A');
  const section = page.locator('#run-section-datasets');
  await section.scrollIntoViewIfNeeded();
  await expect(section).toContainText('deleted');
  // every number is unchanged and the Show link still works (the items are the run's own)
  await expect(section).toContainText('96');
  await section.getByTestId('show-items-link').nth(2).click();
  await expect(page.getByTestId('items-count')).toHaveText('96 items');
});

test('QC-U44: twelve datasets give a twelve-row table and a clamped group', async ({ page }) => {
  await open(page, 1440, url(many));
  await expect(page.getByRole('button', { name: /^\+ 6 more$/ })).toBeVisible();
  const section = page.locator('#run-section-datasets');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId('show-items-link')).toHaveCount(12);
  const box = await section.boundingBox();
  expect(Math.abs(box!.height - 657.9)).toBeLessThanOrEqual(6);
});
