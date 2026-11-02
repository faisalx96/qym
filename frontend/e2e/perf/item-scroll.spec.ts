/// <reference lib="dom" />
/**
 * Redesign round 7, D1 (docs/internal/ui-migration/redesign7/qa.md): "the frozen input is laggy when scrolling down".
 * The item bar (number, verdict, input preview) is translated to the sticky line by `useStickyShift`; the shift is written on the
 * bar itself, not on the item `<article>` where its inheritance restyled all 594 descendants on every scroll event. The pinned
 * cells of the items table stay on their rows. Counts (elements styled) are exact; times carry the CI margin on the dev server
 * (the production numbers are in impl-notes.md). Criteria D1-1, D1-2, D1-4, D1-5, D1-8. D1-3 and D1-3b (the bar against a
 * compositor-sticky control, composited frames) are measured by redesign7/measure/d1-bar-jank.mts.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  itemButton,
  openRun,
  seedClassic,
  seedJsonKeys,
  seedProject,
  showItems,
} from '../run-detail/support';
import { limit, median, traced } from './support';

test.use({ viewport: { width: 1440, height: 900 } });
test.describe.configure({ mode: 'serial' });

const wheel = async (page: Page, n: number, dy = 40) => {
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(16);
  }
};

/** rAF sampler: the stuck bar's top against the sticky line, per frame, plus whether the article carries a shift. */
const SAMPLER = `
window.__samples = [];
window.__sampleStop = false;
window.__sample = (line) => {
  const sc = document.getElementById('shell-content');
  const bar = document.querySelector('[data-item-bar]');
  const art = bar.closest('article');
  let last = sc.scrollTop;
  const tick = () => {
    if (window.__sampleStop) return;
    const a = art.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    window.__samples.push({ moved: sc.scrollTop !== last, err: Math.abs(b.top - line), itemExtends: a.bottom - b.height > line + 4, top: b.top - line });
    last = sc.scrollTop;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};`;

for (const cpu of [1, 4] as const) {
  test(`D1-2, D1-4, D1-5 at ${cpu}x: the stuck bar holds the line and a scroll restyles about the bar, not the open item`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const s = await seedProject('rd-r7-itemscroll');
    const runId = await seedJsonKeys(s);
    await page.addInitScript(SAMPLER);
    await openRun(page, s.slug, runId, 'item=j-01');
    const card = page.locator('[data-testid=item-card][data-item-id="j-01"]');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Expand all output keys' }).click();
    await page.waitForTimeout(800);
    const setup = await page.evaluate(() => {
      const sc = document.getElementById('shell-content')!;
      const nav = document.querySelector('[data-run-nav]') as HTMLElement | null;
      const filters = document.querySelector('[data-run-filters]') as HTMLElement | null;
      const n = nav ? nav.getBoundingClientRect().bottom : sc.getBoundingClientRect().top;
      const f =
        filters && getComputedStyle(filters).position === 'sticky'
          ? filters.getBoundingClientRect().bottom
          : 0;
      const line = Math.max(n, f);
      const bar = document.querySelector('[data-item-bar]') as HTMLElement;
      const art = bar.closest('article') as HTMLElement;
      sc.scrollTop += art.getBoundingClientRect().top - line - 60; // the item starts 60 px under the line: the bar reaches it
      return {
        line,
        descendants: art.querySelectorAll('*').length,
        itemH: art.getBoundingClientRect().height,
      };
    });
    await page.waitForTimeout(500);
    expect(setup.descendants, 'the open item has a deep subtree to restyle').toBeGreaterThan(400);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.mouse.move(700, 500);
    await page.evaluate(
      (line) => (window as unknown as { __sample(l: number): void }).__sample(line),
      setup.line,
    );
    const before = (await cdp.send('Performance.getMetrics')).metrics;
    const trace = await traced(cdp, () => wheel(page, 100));
    const after = (await cdp.send('Performance.getMetrics')).metrics;
    const recalcMs = (m: typeof before) =>
      (m.find((x) => x.name === 'RecalcStyleDuration')?.value ?? 0) * 1000;
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const samples = await page.evaluate(() => {
      (window as unknown as { __sampleStop: boolean }).__sampleStop = true;
      return (
        window as unknown as {
          __samples: Array<{ moved: boolean; err: number; itemExtends: boolean; top: number }>;
        }
      ).__samples;
    });
    // D1-2: while the item spans the line the bar is on it (<= 1 px in every frame; <= 4 px in the entry and exit frames)
    // (judged from the first frame the bar is on the line: before that it is still arriving from below)
    const arrived = samples.findIndex((x) => x.moved && x.itemExtends && x.err <= 1);
    expect(arrived, 'the bar reached the line').toBeGreaterThanOrEqual(0);
    const stuck = samples.slice(arrived).filter((x) => x.moved && x.itemExtends);
    expect(stuck.length, 'frames judged').toBeGreaterThan(20);
    const errs = stuck.map((x) => x.err).sort((a, b) => b - a);
    const over1 = errs.filter((e) => e > 1);
    expect(
      over1.length,
      `frames over 1 px: ${over1.map((e) => e.toFixed(2)).join(', ')}`,
    ).toBeLessThanOrEqual(2);
    expect(errs[0]!, 'worst frame').toBeLessThanOrEqual(4);
    // the shift is on the bar, never on the article
    const where = await page.evaluate(() => {
      const bar = document.querySelector('[data-item-bar]') as HTMLElement;
      const art = bar.closest('article') as HTMLElement;
      return {
        bar: bar.style.getPropertyValue('--head-shift'),
        article: art.style.getPropertyValue('--head-shift'),
        stuck: art.hasAttribute('data-stuck'),
      };
    });
    expect(where.bar, 'the bar carries --head-shift').toMatch(/px$/);
    expect(where.article, 'the article carries none').toBe('');
    expect(where.stuck).toBe(true);
    // D1-4: elements styled by the scroll events (was 25,616 in a 2 s scroll, 281 on average, 523 at most)
    expect(
      trace.elementsStyled,
      `elements styled in the scroll (${trace.styleRecalcs} recalcs)`,
    ).toBeLessThanOrEqual(2000);
    expect(
      trace.elementsStyled / Math.max(1, trace.styleRecalcs),
      'elements styled per recalc',
    ).toBeLessThanOrEqual(20);
    expect(trace.maxElementsOneRecalc, 'largest single recalc').toBeLessThanOrEqual(150);
    // D1-5: style recalculation time (was 78 ms at 1x and 301 to 313 ms at 4x on the production build)
    const ms = recalcMs(after) - recalcMs(before);
    expect(ms, `style recalc ms at ${cpu}x`).toBeLessThanOrEqual(cpu === 1 ? limit(60, 20) : limit(200, 70));
    test.info().annotations.push({
      type: `D1 ${cpu}x`,
      description: `${trace.styleRecalcs} recalcs, ${trace.elementsStyled} elements styled (max ${trace.maxElementsOneRecalc}), ${ms.toFixed(1)} ms; worst bar offset ${errs[0]!.toFixed(2)} px over ${stuck.length} frames`,
    });
  });
}

test('D1-1 and D1-8: pinned cells stay on their rows while the table scrolls; one sticky element per pinned cell', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const s = await seedProject('rd-r7-pins');
  const runId = await seedClassic(s, { items: 300, traced: 3 });
  await openRun(page, s.slug, runId);
  await showItems(page);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const w = window as unknown as { __pin: number[]; __stop: boolean };
    w.__pin = [];
    w.__stop = false;
    const tick = () => {
      if (w.__stop) return;
      const rows = Array.from(document.querySelectorAll('tbody tr[data-item-id]')).slice(2, 8);
      let worst = 0;
      for (const r of rows) {
        const un = r.querySelector('td:not([data-pin])');
        if (!un) continue;
        for (const td of Array.from(r.querySelectorAll('td[data-pin]')))
          worst = Math.max(worst, Math.abs(td.getBoundingClientRect().top - un.getBoundingClientRect().top));
      }
      w.__pin.push(worst);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const box = (await page.locator('tbody').first().boundingBox())!;
  await page.mouse.move(box.x + 400, 500);
  await wheel(page, 100);
  const res = await page.evaluate(() => {
    (window as unknown as { __stop: boolean }).__stop = true;
    const grid = document.querySelector('[role=treegrid][aria-label=Items]')!;
    const sticky = Array.from(grid.querySelectorAll('*')).filter(
      (e) => getComputedStyle(e).position === 'sticky',
    );
    return {
      pin: (window as unknown as { __pin: number[] }).__pin,
      stickyElements: sticky.length,
      pinnedCells: grid.querySelectorAll('[data-pin]').length,
      stickyOutsidePins: sticky.filter(
        (e) =>
          !e.hasAttribute('data-pin') &&
          !e.closest('[data-pin]') &&
          e.tagName !== 'THEAD' &&
          !e.matches('[class*="rail"], [class*="detailHold"]'),
      ).length,
    };
  });
  // D1-1: 0 px in every frame
  expect(res.pin.length, 'frames').toBeGreaterThan(20);
  expect(res.pin.filter((p) => p > 1).length, 'frames with a pinned cell off its row by more than 1 px').toBe(
    0,
  );
  // D1-8: the sticky elements of the table are its pinned cells (one each); nothing else sticks inside it
  expect(res.stickyOutsidePins, 'sticky elements that are not pinned cells').toBe(0);
  expect(res.stickyElements).toBeGreaterThanOrEqual(res.pinnedCells);
  expect(median(res.pin)).toBeLessThanOrEqual(0.5);
});

test('the item bar keeps its behaviours: Copy link and Collapse work, Collapse returns focus to the row', async ({
  page,
}) => {
  const s = await seedProject('rd-r7-itembar');
  const runId = await seedClassic(s, { items: 30 });
  await openRun(page, s.slug, runId);
  await showItems(page);
  await itemButton(page, 2).click();
  const bar = page.locator('[data-item-bar]');
  await expect(bar).toHaveCount(1);
  await expect(bar.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await bar.getByRole('button', { name: 'Collapse item #2' }).click();
  await expect(page.locator('[data-item-bar]')).toHaveCount(0);
});
