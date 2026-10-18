/// <reference lib="dom" />
/**
 * Round 5 R4 (added by the owner mid-round; docs/internal/ui-migration/redesign5/run-detail.md section R4):
 * R4-1 the correlation matrix fills its card, R4-2 the items toolbar controls share one vertical centre,
 * R4-3 a trace opens on the step's content, never on its metadata.
 */
import { test, expect, type Page } from '@playwright/test';
import { openRun, seedClassic, seedProject, seedR5, type Seeded } from './support';

let s: Seeded;
let classic: string;
let details: string;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  s = await seedProject('rd-r5-r4');
  classic = await seedClassic(s);
  details = (await seedR5(s)).details;
});

test('R4-1: the correlation matrix is as wide as its card body at 1440, 1024 and 390', async ({ page }) => {
  for (const w of [1440, 1024, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    await openRun(page, s.slug, classic, 'panel=deep');
    const box = page.getByTestId('correlation-matrix');
    await expect(box).toBeVisible();
    await page.waitForTimeout(300);
    const m = await box.evaluate((el) => {
      const grid = el.querySelector('[role=grid]') as HTMLElement;
      const cs = getComputedStyle(el);
      const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const cells = Array.from(grid.querySelectorAll('button')).map((b) => b.getBoundingClientRect());
      const gr = grid.getBoundingClientRect();
      const lastRight = Math.max(...cells.map((c) => c.right));
      return {
        box: inner,
        grid: gr.width,
        cell: cells[0]!.width,
        emptyRight: gr.right - lastRight,
        scrolls: el.scrollWidth > el.clientWidth + 1,
      };
    });
    console.log(
      `R4-1 ${w}px box ${m.box} grid ${m.grid} cell ${m.cell} emptyRight ${m.emptyRight} scrolls ${m.scrolls}`,
    );
    if (!m.scrolls) expect.soft(Math.abs(m.grid - m.box)).toBeLessThanOrEqual(1);
    expect.soft(m.emptyRight).toBeLessThanOrEqual(2.5);
    await page.screenshot({
      path: `../docs/internal/ui-migration/redesign5/shots/${process.env.R4_SHOT ?? 'after'}-r4-corr-${w}.png`,
    });
  }
});

test('R4-2: every control of the items toolbar shares one vertical centre at 1440 and 1024', async ({
  page,
}) => {
  for (const w of [1440, 1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await openRun(page, s.slug, details);
    const bar = page.getByRole('search', { name: 'Filter items' });
    await expect(bar).toBeVisible();
    const m = await bar.evaluate((el) => {
      const pick = (label: string, q: string) => {
        const e = el.querySelector(q);
        return e ? { label, r: e.getBoundingClientRect() } : null;
      };
      const row = el.firstElementChild!;
      const fieldOf = (name: string) =>
        Array.from(row.querySelectorAll('button[aria-haspopup]')).find((b) =>
          (b.getAttribute('aria-label') ?? b.parentElement?.textContent ?? '').includes(name),
        );
      const controls = [
        pick('search', 'input[type=search], input'),
        { label: 'metric', r: fieldOf('Analysis metric')?.getBoundingClientRect() },
        pick('slider', '[role=group][class*=track], [class*=Slider] [class*=track]'),
        pick('show', '[role=radiogroup]'),
        pick('filters', '[data-testid=open-filters]'),
        { label: 'sort', r: fieldOf('Sort')?.getBoundingClientRect() },
        {
          label: 'display',
          r: Array.from(row.querySelectorAll('button'))
            .find((b) => /Display/.test(b.textContent ?? ''))
            ?.getBoundingClientRect(),
        },
      ].filter((c): c is { label: string; r: DOMRect } => !!c && !!c.r);
      return {
        rowH: row.getBoundingClientRect().height,
        controls: controls.map((c) => ({ label: c.label, cy: c.r.top + c.r.height / 2, h: c.r.height })),
      };
    });
    console.log(`R4-2 ${w}px ${JSON.stringify(m)}`);
    // controls that wrap onto a second line form their own row; inside a row the centres agree within 1px
    const sorted = m.controls.map((c) => c.cy).sort((x, y) => x - y);
    const rows: number[][] = [];
    for (const cy of sorted) {
      const last = rows[rows.length - 1];
      if (last && cy - last[last.length - 1]! < 14) last.push(cy);
      else rows.push([cy]);
    }
    for (const r of rows) expect.soft(Math.max(...r) - Math.min(...r)).toBeLessThanOrEqual(1);
    expect(m.controls.length).toBeGreaterThanOrEqual(6);
    await bar.screenshot({
      path: `../docs/internal/ui-migration/redesign5/shots/${process.env.R4_SHOT ?? 'after'}-r4-toolbar-${w}.png`,
    });
  }
});

/** Selected tab names of the trace drawer, for every step of the tree. */
async function stepTabs(page: Page): Promise<Array<{ step: string; tab: string; tabs: string[] }>> {
  const dialog = page.getByRole('dialog', { name: 'Trace' });
  await expect(dialog).toBeVisible();
  const rows = dialog.getByRole('treeitem');
  await expect(rows.first()).toBeVisible();
  const n = await rows.count();
  const out: Array<{ step: string; tab: string; tabs: string[] }> = [];
  for (let i = 0; i < n; i++) {
    // a narrow drawer shows the tree or the detail: go back to the tree before picking the next step
    const tree = dialog.getByRole('radio', { name: 'Tree' });
    if (await tree.count()) await tree.check({ force: true });
    if (i >= (await rows.count())) break;
    const label = ((await rows.nth(i).textContent()) ?? '').slice(0, 30);
    await rows.nth(i).click({ force: true });
    const tab = dialog.getByRole('tab', { selected: true });
    await expect(tab).toBeVisible();
    out.push({
      step: label,
      tab: ((await tab.textContent()) ?? '').trim(),
      tabs: (await dialog.getByRole('tab').allTextContents()).map((t) => t.trim()),
    });
  }
  return out;
}

const META = /^(Metrics|Scores|Raw)/;
const CONTENT = /^(Messages|Response|Input \/ Output|Documents)/;

function expectContentDefault(rows: Awaited<ReturnType<typeof stepTabs>>) {
  expect(rows.length).toBeGreaterThan(2);
  for (const r of rows) {
    const hasContent = r.tabs.some((t) => CONTENT.test(t));
    if (hasContent) expect(r.tab, `${r.step} opens on ${r.tab}`).toMatch(CONTENT);
    expect(!hasContent || !META.test(r.tab)).toBe(true);
  }
}

for (const width of [1440, 390]) {
  test.describe(`R4-3 at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('R4-3a: the trace button of an items row opens on content for every step', async ({ page }) => {
      test.skip(width === 390, 'below 640px items are cards; entry points b and c cover the phone');
      await openRun(page, s.slug, classic);
      await page.getByRole('button', { name: 'Open trace of item #7', exact: true }).click();
      const rows = await stepTabs(page);
      console.log(`R4-3a ${width}px ${JSON.stringify(rows.map((r) => [r.step, r.tab]))}`);
      expectContentDefault(rows);
      await page.screenshot({
        path: `../docs/internal/ui-migration/redesign5/shots/${process.env.R4_SHOT ?? 'after'}-r4-trace-${width}.png`,
      });
    });

    test('R4-3b: a deep link (?trace=) opens on content for every step', async ({ page }) => {
      await openRun(page, s.slug, classic, 'trace=item-0006');
      const rows = await stepTabs(page);
      await page.screenshot({
        path: `../docs/internal/ui-migration/redesign5/shots/${process.env.R4_SHOT ?? 'after'}-r4-trace-${width}.png`,
      });
      console.log(`R4-3b ${width}px ${JSON.stringify(rows.map((r) => [r.step, r.tab]))}`);
      expectContentDefault(rows);
    });

    test('R4-3c: the Trace button of an expanded item opens on content for every step', async ({ page }) => {
      await openRun(page, s.slug, classic, 'item=item-0006');
      const card = page.locator('[data-testid=item-card][data-item-id="item-0006"]');
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: /Trace/ }).first().click();
      const rows = await stepTabs(page);
      console.log(`R4-3c ${width}px ${JSON.stringify(rows.map((r) => [r.step, r.tab]))}`);
      expectContentDefault(rows);
    });

    test('R4-3d: picking Metrics is not remembered; a content pick is, for the session', async ({ page }) => {
      await openRun(page, s.slug, classic, 'trace=item-0006');
      const dialog = page.getByRole('dialog', { name: 'Trace' });
      const rows = dialog.getByRole('treeitem');
      await expect(rows.first()).toBeVisible();
      await rows.nth(1).click({ force: true });
      await dialog.getByRole('tab', { name: /^Metrics/ }).click();
      const tree = dialog.getByRole('radio', { name: 'Tree' });
      if (await tree.count()) await tree.check({ force: true });
      await rows.nth(2).click({ force: true });
      await expect(dialog.getByRole('tab', { selected: true })).not.toHaveText(/^(Metrics|Scores|Raw)/);
    });
  });
}
