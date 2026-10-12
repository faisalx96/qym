/** Scenario 7: cohort links - banner, Compare | Sweep, verdict, stat cards, outcome filters, item dialog, reverse. */
import { expect, test, type Page } from '@playwright/test';
import { cohortUrl, seedScenario, urlParams, waitLoaded } from './support';
import type { CompareSeed } from './seed';

let seed: CompareSeed;
test.beforeAll(async () => {
  seed = await seedScenario('cmp-coh');
});

const url = (extra: Record<string, string> = {}) => {
  const { base, a, b, c } = seed.runs;
  return cohortUrl([b, base], [a, c], { cohortALabel: 'Weak', cohortBLabel: 'Strong', ...extra });
};
const banner = (page: Page) => page.getByRole('group', { name: 'Compare sides' });
const view = (page: Page) => page.getByRole('radiogroup', { name: 'View' });
const sweep = (page: Page) => page.getByTestId('sweep-view');
const verdictWord = async (page: Page) => {
  const t = (await sweep(page).getByRole('status').first().innerText()).toUpperCase();
  return /IMPROVED|REGRESSED|WITHIN NOISE/.exec(t)?.[0] ?? '';
};

test('banner: labels from the URL, inline rename commits on Enter and rewrites the URL', async ({ page }) => {
  await page.goto(url());
  await waitLoaded(page);
  await expect(banner(page)).toContainText('Weak');
  await expect(banner(page)).toContainText('Strong');
  await expect(banner(page)).toContainText('k = 2 executions each');
  await expect(banner(page).getByText(/^2 executions$/)).toHaveCount(2);
  await banner(page).getByRole('button', { name: 'Rename cohort A' }).click();
  const field = banner(page).getByRole('textbox', { name: 'Label for cohort A' });
  await expect(field).toBeFocused();
  await field.fill('Baseline family');
  await field.press('Enter');
  await expect.poll(() => urlParams(page).get('cohortALabel')).toBe('Baseline family');
  expect(urlParams(page).get('cohortBLabel')).toBe('Strong');
  await expect(banner(page)).toContainText('Baseline family');
  await expect(banner(page).getByRole('textbox')).toHaveCount(0);
  // Escape cancels
  await banner(page).getByRole('button', { name: 'Rename cohort B' }).click();
  await banner(page).getByRole('textbox', { name: 'Label for cohort B' }).fill('zzz');
  await page.keyboard.press('Escape');
  await expect(banner(page).getByRole('textbox')).toHaveCount(0);
  expect(urlParams(page).get('cohortBLabel')).toBe('Strong');
});

test('Compare view shows the cohort verdict word, which agrees with the Sweep banner', async ({ page }) => {
  await page.goto(url());
  await waitLoaded(page);
  const line = page.locator('[aria-label="Change against the baseline"]');
  await expect(line).toContainText(/Strong vs Weak: (Avg|Pass)@2 [+−][\d.]+ pts, (improved|regressed|within noise)/);
  const word = /(improved|regressed|within noise)$/.exec((await line.innerText()).split('Open Sweep')[0]!.trim().replace(/\s+/g, ' '))?.[1];
  expect(word).toBeTruthy();
  // "Open Sweep" and the View switch both go to the Sweep tab
  await line.getByRole('button', { name: 'Open Sweep' }).click();
  await expect(sweep(page)).toBeVisible();
  expect(urlParams(page).get('tab')).toBe('sweep');
  expect((await verdictWord(page)).toLowerCase()).toBe(word);
  await view(page).getByText('Compare').click();
  await expect(sweep(page)).toHaveCount(0);
  await expect(page.getByTestId('item-list')).toBeVisible();
  expect(urlParams(page).get('tab')).toBeNull();
  await view(page).getByText('Sweep').click();
  await expect(sweep(page)).toBeVisible();
});

test('Sweep: verdict banner and five stat cards', async ({ page }) => {
  await page.goto(url({ tab: 'sweep' }));
  await expect(sweep(page)).toBeVisible();
  await expect(sweep(page).getByRole('status').first()).toContainText(/IMPROVED|REGRESSED|WITHIN NOISE/);
  await expect(sweep(page).getByRole('status').first()).toContainText('paired items');
  const stats = sweep(page).getByRole('region', { name: 'Cohort metrics', exact: true });
  // the five stat cards (no data-testid exists for them: located through their data-verdict attribute)
  const cards = stats.locator('[data-verdict]');
  await expect(cards).toHaveCount(5);
  await expect(cards.nth(0)).toContainText('Pass@2');
  await expect(cards.nth(1)).toContainText('Avg@2');
  await expect(cards.nth(2)).toContainText('Consistency');
  await expect(cards.nth(3)).toContainText('Reliability');
  await expect(cards.nth(4)).toContainText('Pass^2');
  for (const i of [0, 1, 2, 3, 4]) await expect(cards.nth(i)).toContainText('→');
  await expect(sweep(page)).toContainText('Weak vs Strong');
});

test('Sweep: outcome cards set sweepMove / sweepOutcome and filter the table', async ({ page }) => {
  await page.goto(url({ tab: 'sweep' }));
  await expect(sweep(page)).toBeVisible();
  const rows = sweep(page).getByRole('region', { name: 'Items' }).locator('tbody tr');
  const total = await rows.count();
  expect(total).toBeGreaterThan(5);
  const card = (label: string) => sweep(page).getByRole('button', { name: new RegExp(`${label}$`) });
  const num = async (label: string) => Number((await card(label).innerText()).split('\n')[0]);

  const improved = await num('Improved');
  expect(improved).toBeGreaterThan(0);
  await card('Improved').click();
  await expect.poll(() => urlParams(page).get('sweepMove')).toBe('improved');
  await expect(card('Improved')).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(improved);
  await card('Improved').click();
  await expect.poll(() => urlParams(page).get('sweepMove')).toBeNull();
  await expect(rows).toHaveCount(total);

  const fixed = await num('Decisively fixed');
  await card('Decisively fixed').click();
  await expect.poll(() => urlParams(page).get('sweepOutcome')).toBe('right_sweeps_left');
  await expect(card('Decisively fixed')).toHaveAttribute('aria-pressed', 'true');
  if (fixed > 0) await expect(rows).toHaveCount(fixed);
  else await expect(sweep(page).getByText('No items match these filters')).toBeVisible();
  // deep link restores it
  await page.reload();
  await expect(sweep(page)).toBeVisible();
  await expect(card('Decisively fixed')).toHaveAttribute('aria-pressed', 'true');
});

test('Sweep: a row opens the item dialog with a focus trap; Escape closes and focus returns', async ({ page }) => {
  await page.goto(url({ tab: 'sweep' }));
  await expect(sweep(page)).toBeVisible();
  const opener = sweep(page).getByRole('button', { name: /^Open item cmp-/ }).first();
  const label = (await opener.getAttribute('aria-label')) ?? '';
  const id = label.replace('Open item ', '');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: `Item ${id}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('item-detail')).toBeVisible();
  await expect(dialog.getByTestId('output-card').first()).toBeVisible();
  // focus stays inside the dialog while tabbing past its last control
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Sweep: Reverse sides flips the sides and the delta sign', async ({ page }) => {
  await page.goto(url({ tab: 'sweep' }));
  await expect(sweep(page)).toBeVisible();
  const headers = () => sweep(page).getByRole('region', { name: 'Items' }).getByRole('columnheader').allInnerTexts();
  expect((await headers()).map((h) => h.replace(/[↕↑↓]/g, '').trim())).toEqual(['Item', 'Metadata', 'Weak', 'Strong', 'Move']);
  const word = await verdictWord(page);
  const btn = sweep(page).getByRole('button', { name: 'Reverse sides' });
  await btn.click();
  await expect.poll(() => urlParams(page).get('sweepReverse')).toBe('1');
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await headers()).map((h) => h.replace(/[↕↑↓]/g, '').trim())).toEqual(['Item', 'Metadata', 'Strong', 'Weak', 'Move']);
  const flipped = await verdictWord(page);
  const mirror: Record<string, string> = { IMPROVED: 'REGRESSED', REGRESSED: 'IMPROVED', 'WITHIN NOISE': 'WITHIN NOISE' };
  expect(flipped).toBe(mirror[word]);
  await btn.click();
  await expect.poll(() => urlParams(page).get('sweepReverse')).toBeNull();
});
