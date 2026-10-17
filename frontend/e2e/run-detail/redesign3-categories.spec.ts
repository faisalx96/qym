/// <reference lib="dom" />
/** Round 3 P3 (run-detail.md section 3): categories one key at a time. P3-1 .. P3-9 on the many-categories run. */
import { test, expect } from '@playwright/test';
import { itemsCount, openRun, params, seedCategories, seedProject, type Seeded } from './support';

let s: Seeded;
let many: string;

test.beforeAll(async () => {
  s = await seedProject('rd-r3-categories');
  many = await seedCategories(s);
});

const section = '#run-section-categories';

for (const width of [1440, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('P3-1, P3-2, P3-3, P3-7: few controls, one key, six rows, the widest spread opens first', async ({
      page,
    }) => {
      await openRun(page, s.slug, many, 'panel=categories');
      const sec = page.locator(section);
      await expect(sec.getByRole('group', { name: /^Values of / })).toHaveCount(1);
      // no "+" buttons and no "Rank by" select
      await expect(sec.getByRole('button', { name: /^Add / })).toHaveCount(0);
      await expect(sec.getByRole('button', { name: /Rank by/ })).toHaveCount(0);
      // interactive elements above the first value row: the switcher options (or one Select) and the Order control (2 options)
      const above = await page.evaluate(() => {
        const sec = document.getElementById('run-section-categories')!;
        const first = sec.querySelector('[data-testid=category-row]')!.getBoundingClientRect().top;
        return Array.from(sec.querySelectorAll('button, [role=radio], [role=combobox]')).filter(
          (e) => e.getBoundingClientRect().top < first && !e.closest('[data-testid=category-row]'),
        ).length;
      });
      expect(above).toBeLessThanOrEqual(5 + 2 + 1);
      const rows = page.getByTestId('category-row');
      await expect(rows).toHaveCount(6);
      await page.getByRole('button', { name: 'Show all 24 values' }).click();
      await expect(rows).toHaveCount(24);
      await page.getByRole('button', { name: 'Show fewer' }).click();
      await expect(rows).toHaveCount(6);
      await expect(sec.getByRole('region', { name: 'topic' })).toBeVisible(); // 24 values, the widest spread
    });

    test('P3-4, P3-5, P3-9: the bar is next to the value, one tick x for every row, no sideways scroll', async ({
      page,
    }) => {
      await openRun(page, s.slug, many, 'panel=categories');
      const geo = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-testid=category-row]'));
        return rows.map((r) => {
          const name = r.querySelector('[data-part=name]')!.getBoundingClientRect();
          const track = r.querySelector('[role=img]')!.getBoundingClientRect();
          const tick = r.querySelector('[data-testid=category-tick]')!.getBoundingClientRect();
          return {
            gap: track.left - name.left,
            trackWidth: track.width,
            trackLeft: track.left,
            tickRel: tick.left - track.left,
            sameLine: Math.abs(track.top - name.top) < 4,
            rowRight: r.getBoundingClientRect().right,
          };
        });
      });
      const first = geo[0]!;
      for (const r of geo) {
        expect(Math.abs(r.tickRel - first.tickRel)).toBeLessThanOrEqual(1);
        if (width === 1440) {
          expect(r.gap).toBeLessThanOrEqual(240 + 8 + 14);
          expect(r.sameLine).toBe(true);
        } else {
          // phone: the bar is full width on its own line
          expect(r.sameLine).toBe(false);
          expect(r.trackWidth).toBeGreaterThan(150);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('P3-8: the whole section with the 24-value key is at most 540px at 1440 (spec amended from 460) and 740px at 390, collapsed', async ({
      page,
    }) => {
      await openRun(page, s.slug, many, 'panel=categories');
      await expect(page.getByTestId('category-row').first()).toBeVisible();
      const h = (await page.locator(section).boundingBox())!.height;
      expect(h, 'section height').toBeLessThanOrEqual(width === 1440 ? 540 : 740);
    });
  });
}

test('P3-6: a row click toggles the existing filter, aria-pressed follows, a scope chip appears', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, many, 'panel=categories');
  const before = (await itemsCount(page))[0];
  const row = page.getByTestId('category-row').first();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await itemsCount(page))[0]).toBeLessThan(before);
  await expect(page.getByRole('button', { name: /^Remove filter / }).first()).toBeVisible();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await itemsCount(page))[0]).toBe(before);
});

test('P3-7: ?category= selects the key on load and the switcher writes it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRun(page, s.slug, many, 'panel=categories&category=customer_tier');
  await expect(page.locator(section).getByRole('region', { name: 'customer_tier' })).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Category' })
    .getByRole('radio', { name: /^region/ })
    .click({ force: true });
  await expect.poll(() => params(page).get('category')).toBe('region');
});
