/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { postHeartbeatControl, postWorkerEvents, seedLive, seedWorkerControl } from './support';

let seed: Awaited<ReturnType<typeof seedLive>>;
test.beforeAll(async ({ request }) => {
  seed = await seedLive(request, uniqueSlug('live-widths'), { days: 14 });
  await seedWorkerControl(request, seed.projectId, seed.apiKey, seed.sourceKey, seed);
  await postHeartbeatControl(request, seed.projectId, seed.apiKey, seed.sourceKey, {
    state: 'running',
    settings_version_applied: 1,
    errors_last_hour: 3,
  });
  await postWorkerEvents(
    request,
    seed.projectId,
    seed.apiKey,
    seed.sourceKey,
    ['langfuse', 'gateway', 'database'].map((component) => ({
      at: new Date().toISOString(),
      level: 'error' as const,
      component,
      code: `${component}_unavailable`,
      message: `The ${component} connection could not be reached by the evaluation worker`,
      details: {},
    })),
  );
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

async function responsiveRow(first: Locator, second: Locator, breakpoint = 900) {
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  const containerWidth = await first.evaluate(
    (element) => element.parentElement!.getBoundingClientRect().width,
  );
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  if (containerWidth < breakpoint) {
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1);
  } else {
    expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1);
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width);
    if (breakpoint === 1100) expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
  }
}

for (const viewport of viewports) {
  test.describe(`${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport });

    test('Worker settings and three problems fit without horizontal page scroll', async ({ page }) => {
      await gotoApp(
        page,
        `/projects/${seed.projectSlug}/live/worker?${new URLSearchParams({ source: seed.sourceKey })}`,
      );
      await expect(
        page.locator('[data-live-block="worker-status"]').getByText('v1', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-worker-event]')).toHaveCount(3);
      await page.evaluate(() => document.fonts.ready);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        )
        .toBe(true);
    });

    test('Charts screenshots fit the page and full-image dialog', async ({ page }) => {
      const id = `${seed.days.at(-1)!.day}/turn-2`;
      await gotoApp(
        page,
        `/projects/${seed.projectSlug}/live/turns/${encodeURIComponent(id)}?${new URLSearchParams({ source: seed.sourceKey, tab: 'charts' })}`,
      );
      const screenshot = page.locator('[data-live-chart-image] img');
      await expect(screenshot).toBeVisible();
      await expect
        .poll(() => screenshot.evaluate((element: HTMLImageElement) => element.naturalWidth))
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        )
        .toBe(true);
      await screenshot.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
        )
        .toBe(true);
    });

    test('LV-31, LV-34: overview cards stack, fourteen days stay visible and values are tabular', async ({
      page,
    }) => {
      const query = new URLSearchParams({ source: seed.sourceKey, day: seed.days.at(-1)!.day });
      await gotoApp(page, `/projects/${seed.projectSlug}/live?${query}`);
      await expect(page.locator('[data-live-trend-day]')).toHaveCount(14);
      await noPageOverflow(page);
      await responsiveRow(
        page.locator('[data-live-block="mix"]'),
        page.locator('[data-live-block="means"]'),
        1100,
      );
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
      if (viewport.width === 1440) {
        for (const block of ['services', 'days', 'mix', 'means']) {
          const card = page.locator(`[data-live-block="${block}"]`);
          const head = (await card.locator('[data-level="lg"]').boundingBox())!;
          const first = (await card
            .locator('tbody tr')
            .first()
            .locator('td')
            .first()
            .locator('[data-cell]')
            .boundingBox())!;
          const last = (await card
            .locator('tbody tr')
            .first()
            .locator('td')
            .last()
            .locator('[data-cell]')
            .boundingBox())!;
          expect(Math.abs(first.x - head.x), `${block} start edge`).toBeLessThanOrEqual(1);
          expect(
            Math.abs(last.x + last.width - head.x - head.width),
            `${block} end edge`,
          ).toBeLessThanOrEqual(1);
        }
        const days = page.locator('[data-live-block="days"]');
        const mix = (await days.locator('th[data-col="mix"]').boundingBox())!;
        for (const id of ['turns_seen', 'evaluated', 'waiting']) {
          const header = days.locator(`th[data-col="${id}"]`);
          await expect(header).toHaveCSS('text-align', 'end');
          await expect(days.locator(`tbody td[data-col="${id}"]`).first()).toHaveCSS('text-align', 'end');
          const width = (await header.boundingBox())!.width;
          expect(width).toBeLessThanOrEqual(100);
          expect(width).toBeLessThan(mix.width);
        }
      }
      const days = page.locator('[data-live-block="days"]');
      const head = (await days.locator('[data-level="lg"]').boundingBox())!;
      const pager = days.getByRole('navigation', { name: 'days pagination' });
      const summary = (await pager.locator('[aria-live="polite"]').boundingBox())!;
      const lastButton = (await pager.getByRole('button', { name: 'Last page' }).boundingBox())!;
      expect(Math.abs(summary.x - head.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(lastButton.x + lastButton.width - head.x - head.width)).toBeLessThanOrEqual(1);
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
      const searchBox = (await filters.getByRole('searchbox').boundingBox())!;
      const groupBox = (await filters.getByRole('group', { name: 'Turn filters' }).boundingBox())!;
      expect(searchBox.y).toBeGreaterThanOrEqual(groupBox.y);
      expect(searchBox.y + searchBox.height).toBeLessThanOrEqual(groupBox.y + groupBox.height);
      await expect(filters.getByRole('button', { name: 'Clear 1 filter' })).toBeVisible();
      await expect(
        filters.getByRole('group', { name: 'Active filters' }).getByRole('button', { name: /^Remove / }),
      ).toHaveCount(0);
      const dayButton = filters.getByRole('button', { name: /^Day: .* filter/ });
      const moreButton = filters.getByRole('button', { name: /More filters/ });
      const selectedChip = filters.getByRole('button', { name: 'All', exact: true });
      for (const property of ['background-color', 'border-top-color', 'color']) {
        const selectedColor = await selectedChip.evaluate(
          (el, property) => getComputedStyle(el).getPropertyValue(property),
          property,
        );
        await expect(dayButton).toHaveCSS(property, selectedColor);
      }
      const dayBox = (await dayButton.boundingBox())!;
      const moreBox = (await moreButton.boundingBox())!;
      expect(dayBox.y).toBeCloseTo(moreBox.y, 0);
      expect(searchBox.y).toBeCloseTo(dayBox.y, 0);
      expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(dayBox.x);
      expect(dayBox.x + dayBox.width).toBeLessThanOrEqual(moreBox.x);
      await noPageOverflow(page);
      await expect(filters.getByRole('button', { name: /More filters/ })).toBeVisible();
      await expect(filters.getByRole('button', { name: /Charts/ })).toHaveCount(0);
      const frame = page.getByRole('region', { name: 'Live turns (scrollable)', exact: true });
      await expect(frame).toBeVisible();
      await expect(page.getByRole('treegrid', { name: 'Live turns', exact: true })).toHaveCSS(
        'direction',
        'ltr',
      );
      const arabic = page.locator(`[data-live-turn-row="${day}/turn-1"] [data-live-question]`);
      await expect(arabic).toHaveAttribute('dir', 'rtl');
      await expect(arabic).toHaveCSS('direction', 'rtl');
      await expect(page.locator(`[data-live-turn-row="${day}/turn-2"] [data-live-question]`)).toHaveCSS(
        'direction',
        'ltr',
      );
      await monoNumbers(page.locator('[data-live-turn-row] td[data-mono]'));
      // Narrow screens keep scrolling inside the frame; the dedicated 1366px test covers the desktop fit.
      expect(await frame.evaluate((el) => el.scrollWidth >= el.clientWidth)).toBe(true);
      await page.locator('[data-live-turn-row]').first().getByRole('button', { name: 'Expand row' }).click();
      const details = page.locator('[data-live-turn-details]');
      await expect(details).toBeVisible();
      const time = (await page.locator('[data-live-turn-row]').first().locator('time').boundingBox())!;
      const why = (await details.getByText('Why this diagnosis', { exact: true }).boundingBox())!;
      expect(why.x).toBeCloseTo(time.x, 0);
      const bounds = (await details.boundingBox())!;
      const frameBounds = (await frame.boundingBox())!;
      expect(why.y).toBeGreaterThan(bounds.y);
      expect(bounds.x).toBeGreaterThanOrEqual(frameBounds.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(frameBounds.x + frameBounds.width);
      expect(await details.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
      const clippedText = await details.evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const clipped: string[] = [];
        while (walker.nextNode()) {
          const text = walker.currentNode;
          if (!text.textContent?.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          if (
            Array.from(range.getClientRects()).some((r) => r.left < bounds.left || r.right > bounds.right)
          ) {
            clipped.push(text.textContent);
          }
        }
        return clipped;
      });
      expect(clippedText).toEqual([]);
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
        ['diagnosis-steps', 'rules'],
        ['rules', 'turn-facts'],
      ]) {
        const a = page.locator(`[data-live-block="${first}"]`);
        const b = page.locator(`[data-live-block="${second}"]`);
        await expect(a).toBeVisible();
        await expect(b).toBeVisible();
        const aBox = (await a.boundingBox())!;
        const bBox = (await b.boundingBox())!;
        expect(bBox.y).toBeGreaterThanOrEqual(aBox.y + aBox.height);
        expect(Math.abs(bBox.x - aBox.x)).toBeLessThanOrEqual(1);
      }
      await expect(page.getByRole('tablist', { name: 'Turn sections' })).toHaveCSS('direction', 'ltr');
      await expect(page.locator('[data-live-block="turn-header"] [data-live-question]')).toHaveAttribute(
        'dir',
        'rtl',
      );
      await expect(page.locator('[data-live-block="turn-header"] [data-live-question]')).toHaveCSS(
        'direction',
        'rtl',
      );
      await expect(page.locator('[data-live-stat]')).toHaveCount(6);
      await monoNumbers(page.locator('[data-live-stat]'));
      await page.getByRole('tab', { name: 'Answer and SQL', exact: true }).click();
      await expect(page.locator('[data-live-answer]')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('[data-live-answer]')).toHaveCSS('direction', 'rtl');
      await noPageOverflow(page);
      await page.getByRole('tab', { name: 'Judges', exact: true }).click();
      const judgeA = page.locator('[data-live-card="judge-a"]');
      const judgeB = page.locator('[data-live-card="judge-b"]');
      await responsiveRow(judgeA, judgeB);
      const judgeWidth = await judgeA.evaluate(
        (element) => element.parentElement!.getBoundingClientRect().width,
      );
      for (const language of ['English', 'العربية', 'Both']) {
        await page
          .getByRole('radiogroup', { name: 'Explanation language' })
          .getByText(language, { exact: true })
          .click();
        await expect(page.getByRole('radio', { name: language, exact: true })).toBeChecked();
        if (judgeWidth >= 900) {
          for (const facet of ['identity', 'scores', 'reasoning', 'deviations']) {
            await expect
              .poll(async () => {
                const a = (await judgeA.locator(`[data-judge-facet="${facet}"]`).boundingBox())!;
                const b = (await judgeB.locator(`[data-judge-facet="${facet}"]`).boundingBox())!;
                return Math.max(Math.abs(a.y - b.y), Math.abs(a.height - b.height));
              })
              .toBeLessThanOrEqual(1);
          }
        }
        await noPageOverflow(page);
      }
      await expect(page.locator('[data-judge-facet][data-empty]')).toHaveCount(0);
      await page.getByRole('tab', { name: 'Services and tools', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Service glance' })).toHaveCount(0);
      const serviceTable = page.getByRole('treegrid', { name: 'Services', exact: true });
      const expand = serviceTable.getByRole('button', { name: 'Expand row' }).first();
      if (await expand.count()) {
        await expand.click();
        const signals = page.getByLabel('Signals', { exact: true });
        await expect(signals).toBeVisible();
        for (const name of ['Raw', 'Sections', 'Copy JSON', 'Expand all keys'])
          await expect(signals.getByRole('button', { name, exact: true })).toHaveCount(0);
        const cardBox = (await page.locator('[data-live-card="services"]').boundingBox())!;
        const signalBoxes = await signals.locator('dt, dd').evaluateAll((items) =>
          items.map((item) => {
            const box = item.getBoundingClientRect();
            return { left: box.left, right: box.right };
          }),
        );
        for (const box of signalBoxes) {
          expect(box.left).toBeGreaterThanOrEqual(cardBox.x);
          expect(box.right).toBeLessThanOrEqual(cardBox.x + cardBox.width);
        }
      }
      await noPageOverflow(page);
      await page.getByRole('tab', { name: 'Conversation', exact: true }).click();
      const questions = page
        .getByRole('grid', { name: 'Conversation turns' })
        .locator('[data-live-question]');
      await expect(questions).toHaveCount(3);
      await expect(questions.nth(0)).toHaveAttribute('dir', 'rtl');
      await expect(questions.nth(0)).toHaveCSS('text-align', 'start');
      await expect(questions.nth(1)).toHaveAttribute('dir', 'auto');
      await expect(questions.nth(1)).toHaveCSS('direction', 'ltr');
      await noPageOverflow(page);
    });
  });
}
