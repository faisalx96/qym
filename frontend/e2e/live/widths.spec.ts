/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { seedLive } from './support';

let seed: Awaited<ReturnType<typeof seedLive>>;
test.beforeAll(async ({ request }) => {
  seed = await seedLive(request, uniqueSlug('live-widths'), { days: 14 });
});

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];

async function noPageOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth)))
    .toBe(0);
}

async function autoDirection(text: Locator, direction: 'rtl' | 'ltr') {
  await text.scrollIntoViewIfNeeded();
  await expect(text).toHaveAttribute('dir', 'auto');
  await expect(text).toHaveCSS('direction', direction);
  await expect(text).toHaveCSS('text-align', 'start');
}

async function monoNumbers(values: Locator) {
  expect(await values.count()).toBeGreaterThan(0);
  const styles = await values.evaluateAll((elements) =>
    elements.map((element) => {
      const computed = getComputedStyle(element);
      return { family: computed.fontFamily, numeric: computed.fontVariantNumeric };
    }),
  );
  for (const style of styles) {
    expect(style.family).toMatch(/mono/i);
    expect(style.numeric).toContain('tabular-nums');
  }
}

async function responsiveRow(first: Locator, second: Locator) {
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const containerWidth = await first.evaluate(
    (element) => element.parentElement!.getBoundingClientRect().width,
  );
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  if (containerWidth < 900) {
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1);
  } else {
    expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1);
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
  }
}

for (const viewport of viewports) {
  test.describe(`${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    test('LV-31, LV-34: overview cards stack, fourteen days stay visible and values are tabular', async ({
      page,
    }) => {
      const query = new URLSearchParams({ source: seed.sourceKey, day: seed.days.at(-1)!.day });
      await gotoApp(page, `/projects/${seed.projectSlug}/live?${query}`);
      await expect(page.locator('[data-live-trend-day]')).toHaveCount(14);
      await noPageOverflow(page);
      await responsiveRow(page.locator('[data-live-block="mix"]'), page.locator('[data-live-block="means"]'));
      const columns = page.locator('[data-live-trend-day]');
      expect(
        await columns.evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-live-trend-day')),
        ),
      ).toEqual(seed.days.map((day) => day.day));
      const plot = (await page.locator('[data-live-block="trend-plot"]').boundingBox())!;
      for (const column of await columns.all()) {
        await expect(column).toBeVisible();
        const box = (await column.boundingBox())!;
        expect(box.width).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(plot.x - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(plot.x + plot.width + 1);
      }
      await expect(page.locator('[data-live-stat]')).toHaveCount(6);
      await monoNumbers(page.locator('[data-live-stat], [data-live-block="days"] tbody td[data-mono]'));
    });

    test('LV-31, LV-33, LV-34: turns scroll inside their frame and Arabic stays within LTR chrome', async ({
      page,
    }) => {
      const day = seed.days.at(-1)!.day;
      await gotoApp(
        page,
        `/projects/${seed.projectSlug}/live/turns?${new URLSearchParams({ source: seed.sourceKey, day })}`,
      );
      await expect(page.locator('[data-live-turn-row]')).toHaveCount(12);
      await page.evaluate(() => document.fonts.ready);
      const filters = page.locator('[data-live-block="filters"]');
      const filterBox = (await filters.boundingBox())!;
      expect(Math.abs(filterBox.height - (viewport.width === 390 ? 87 : 49))).toBeLessThanOrEqual(1);
      await expect(filters.getByRole('group', { name: 'Active filters' })).toHaveCount(0);
      await noPageOverflow(page);
      // A compact filter strip owns its horizontal overflow; it never widens the page.
      const strip = filters.getByRole('group', { name: 'Turn filters' });
      await strip.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect(filters.getByRole('button', { name: /Charts$/ })).toBeVisible();
      const frame = page.getByRole('region', { name: 'Live turns (scrollable)', exact: true });
      await expect(frame).toBeVisible();
      expect(await frame.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
        await frame.evaluate((element) => element.clientWidth),
      );
      await noPageOverflow(page);
      await expect(page.getByRole('grid', { name: 'Live turns', exact: true })).toHaveCSS('direction', 'ltr');
      const arabic = page.locator(`[data-live-turn-row="${day}/turn-1"] [data-live-question]`);
      await autoDirection(arabic, 'rtl');
      await autoDirection(page.locator(`[data-live-turn-row="${day}/turn-2"] [data-live-question]`), 'ltr');
      await noPageOverflow(page);
      for (const question of await page.locator('[data-live-question]').all()) {
        await expect(question).toHaveAttribute('dir', 'auto');
      }
      await monoNumbers(
        page.locator('[data-live-turn-row] td[data-mono], [data-live-turn-row] td[data-col="charts"]'),
      );
      await frame.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      expect(await frame.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await noPageOverflow(page);
    });

    test('LV-31, LV-33, LV-34: turn card rows stack, Arabic text aligns right and values are tabular', async ({
      page,
    }) => {
      const id = `${seed.days.at(-1)!.day}/turn-1`;
      await gotoApp(
        page,
        `/projects/${seed.projectSlug}/live/turns/${encodeURIComponent(id)}?${new URLSearchParams({ source: seed.sourceKey })}`,
      );
      await expect(page.locator('[data-live-block="turn-tiles"]')).toBeVisible();
      await noPageOverflow(page);
      for (const [first, second] of [
        ['why', 'deviations'],
        ['agent-sql', 'judge-sql'],
        ['answer', 'chart'],
        ['chart', 'turn-services'],
      ]) {
        await responsiveRow(
          page.locator(`[data-live-block="${first}"]`),
          page.locator(`[data-live-block="${second}"]`),
        );
      }
      await expect(page.getByRole('tablist', { name: 'Turn sections' })).toHaveCSS('direction', 'ltr');
      await autoDirection(page.locator('[data-live-block="turn-header"] [data-live-question]'), 'rtl');
      await autoDirection(page.locator('[data-live-answer]'), 'rtl');
      await autoDirection(page.locator('[data-live-answer] [data-text-mode]'), 'rtl');
      await expect(page.locator('[data-live-stat]')).toHaveCount(6);
      await monoNumbers(page.locator('[data-live-stat]'));
      await page.getByRole('tab', { name: 'Answer and SQL', exact: true }).click();
      await autoDirection(page.locator('[data-live-answer]'), 'rtl');
      await noPageOverflow(page);
      await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
      const questions = page
        .getByRole('list', { name: 'Conversation turns' })
        .locator('[data-live-question]');
      await expect(questions).toHaveCount(3);
      await autoDirection(questions.nth(0), 'rtl');
      await autoDirection(questions.nth(1), 'ltr');
      await noPageOverflow(page);
    });
  });
}
