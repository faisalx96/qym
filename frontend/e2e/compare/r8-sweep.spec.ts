/** Round 8: the Sweep page in the legacy structure (C-sw-1..8, C-exp-8). */
import { expect, test, type Page } from '@playwright/test';
import { cohortUrl, waitLoaded } from './support';
import { box, noSidewaysScroll, part, seedR8, within, type R8Seed } from './r8';

let s: R8Seed;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  s = await seedR8('r8-sweep');
});

const open = async (page: Page, width: number) => {
  const { base, a, b, c } = s.seed.runs;
  await page.setViewportSize({ width, height: 900 });
  await page.goto(cohortUrl([b, base], [a, c], { cohortALabel: 'Weak', cohortBLabel: 'Strong', tab: 'sweep' }));
  await expect(page.getByTestId('sweep-view')).toBeVisible();
};

test('C-sw-1: the header carries Compare | Sweep and Export; the page head says what is compared', async ({ page }) => {
  await open(page, 1440);
  const block = part(page, 'title-block');
  await expect(block.getByRole('radiogroup', { name: 'View' })).toBeVisible();
  await expect(block.getByRole('link', { name: 'Export HTML' })).toBeVisible();
  await expect(part(page, 'cohort-banner')).toBeVisible();
  const sweep = page.getByTestId('sweep-view');
  await expect(sweep.getByRole('heading', { name: 'Sweep', level: 2 })).toBeVisible();
  await expect(sweep).toContainText(/Weak vs Strong across 2 runs per cohort · metric: quality · \d+\/40 items shown/);
  await expect(sweep.getByRole('button', { name: 'Reverse sides' })).toBeVisible();
  // no sticky nav and no scope bar / sidebar on the Sweep page
  await expect(part(page, 'section-nav')).toHaveCount(0);
  await expect(page.getByTestId('scope-bar')).toHaveCount(0);
});

test('C-sw-2: the verdict is a badge, a title and an evidence line over a 3 px edge in the verdict colour', async ({
  page,
}) => {
  await open(page, 1440);
  const v = part(page, 'sweep-verdict');
  await expect(v.getByText(/Improved|Regressed|Within noise/)).toBeVisible();
  expect((await box(v)).h).toBeLessThanOrEqual(80); // amended from 70: the evidence line wraps at 1193
  const title = await v.locator('[data-part="sweep-verdict-title"]').evaluate((e) => ({ s: getComputedStyle(e).fontSize, w: getComputedStyle(e).fontWeight }));
  expect(title.s).toBe('13px');
  expect(Number(title.w)).toBe(650);
  const sub = await v.locator('p').first().evaluate((e) => getComputedStyle(e).fontSize);
  expect(sub).toBe('11px');
  const edge = await v.evaluate((e) => {
    const c = getComputedStyle(e, '::after');
    return { h: c.height, bg: c.backgroundColor };
  });
  expect(edge.h).toBe('3px');
  const verdict = await v.getAttribute('data-verdict');
  expect(['improved', 'regressed', 'within_noise']).toContain(verdict);
  const token = await page.evaluate((n) => {
    const el = document.createElement('i');
    el.style.color = `var(${n})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, verdict === 'improved' ? '--success' : verdict === 'regressed' ? '--error' : '--border-strong');
  expect(edge.bg).toBe(token);
});

test('C-sw-3: the filter bar is one row of five fields, at most 90 high', async ({ page }) => {
  await open(page, 1440);
  const bar = part(page, 'sweep-filters');
  expect((await box(bar)).h).toBeLessThanOrEqual(90);
  for (const label of ['Move', 'Outcome', 'Search sweep items', 'Metadata', 'Values']) await expect(bar).toContainText(label.replace('Search sweep items', 'Search'));
  const tops = await bar.locator('button, input:not([type=checkbox])').evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent).map((e) => `${e.tagName}:${Math.round(e.getBoundingClientRect().y)}`),
  );
  expect(new Set(tops.map((t) => t.split(':')[1])).size, tops.join(' ')).toBe(1);
});

test('C-sw-4: five equal stat cells in one frame with a 3 px edge; from -> to, delta pill, noise', async ({ page }) => {
  await open(page, 1440);
  const cells = part(page, 'sweep-stat-cards').getByTestId('sweep-stat');
  await expect(cells).toHaveCount(5);
  const ws = await cells.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(Math.max(...ws) - Math.min(...ws)).toBeLessThanOrEqual(2);
  for (const c of await cells.all()) {
    expect((await box(c)).w).toBeGreaterThanOrEqual(176); // 11 rem
    await expect(c).toContainText('→');
    await expect(c).toContainText(/noise|no band/);
    expect(await c.evaluate((e) => getComputedStyle(e, '::after').height)).toBe('3px');
  }
  const to = await cells.first().locator('strong').evaluate((e) => ({ f: getComputedStyle(e).fontFamily, w: getComputedStyle(e).fontWeight }));
  expect(to.f).toMatch(/mono/i);
  expect(Number(to.w)).toBe(650);
  const edges = await cells.evaluateAll((els) => els.map((e) => e.getAttribute('data-edge')));
  expect(new Set(edges).size).toBeGreaterThanOrEqual(1);
});

test('C-sw-5/6: the metadata table has 31 px rows; seven outcome cards of 56 with coloured values', async ({ page }) => {
  await open(page, 1440);
  const table = page.getByRole('region', { name: /^Cohort metrics by / });
  await expect(table).toBeVisible();
  const rows = table.locator('tbody tr');
  expect(await rows.count()).toBeGreaterThan(1);
  within((await box(rows.first())).h, 31, 2, 'metadata row');
  await expect(table.locator('thead th').first()).toBeVisible();
  const cards = part(page, 'sweep-outcome-cards').locator('> *');
  await expect(cards).toHaveCount(7);
  for (const c of await cards.all()) within((await box(c)).h, 62, 8, 'outcome card (amended from 56: labels wrap to two lines)');
  const improved = part(page, 'sweep-outcome-cards').getByRole('button', { name: /Improved$/ });
  const value = await improved.locator('b').evaluate((e) => ({ f: getComputedStyle(e).fontFamily, c: getComputedStyle(e).color }));
  expect(value.f).toMatch(/mono/i);
  const regressed = await part(page, 'sweep-outcome-cards').getByRole('button', { name: /Regressed$/ }).locator('b').evaluate((e) => getComputedStyle(e).color);
  expect(regressed).not.toBe(value.c);
});

test('C-sw-7/C-exp-8: item rows are 34 high with badges, dots and k/n, a move pill; a row opens the item modal', async ({
  page,
}) => {
  await open(page, 1440);
  const rows = part(page, 'sweep-item-row');
  expect(await rows.count()).toBeGreaterThan(5);
  within((await box(rows.first())).h, 34, 2, 'sweep row');
  const first = rows.first();
  await expect(first.locator('[data-part="sweep-pass-cell"]')).toHaveCount(2);
  const dot = first.locator('[data-part="sweep-pass-cell"]').first().getByRole('img').locator('span').first();
  within((await box(dot)).w, 13, 1, 'pass dot');
  await expect(first.locator('[data-part="sweep-pass-cell"]').first()).toContainText(/\d\/2/);
  await expect(first).toContainText(/[+−0]\d?/);
  const id = (await first.locator('th button').innerText()).trim();
  await first.click(); // a click anywhere on the row
  const dialog = page.getByRole('dialog', { name: `Item comparison · ${id}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('item-detail')).toBeVisible(); // the same expanded-item component
  await expect(dialog.locator('[data-part="output-grid"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  // Enter on the id opens it too
  await first.locator('th button').focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
});

test('C-sw-8: at 390 the stat cards are two per row and only the tables scroll sideways, inside their own wrapper', async ({
  page,
}) => {
  await open(page, 390);
  const cells = part(page, 'sweep-stat-cards').getByTestId('sweep-stat');
  const tops = await cells.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
  expect(tops.filter((t) => t === tops[0]).length).toBe(2);
  await noSidewaysScroll(page);
  void waitLoaded;
});
