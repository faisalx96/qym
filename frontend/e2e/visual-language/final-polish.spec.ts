/**
 * Final polish pass: Admin and Overview run cells, compare error cards, the wizard's single bottom bar and the
 * sweep's section scale and rhythm.
 */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl, cohortUrl, seedScenario, waitLoaded } from '../compare/support';
import type { CompareSeed } from '../compare/seed';
import { gotoApp } from '../helpers';
import { runUrl } from '../run-detail/support';
import { createLaunchAreas, seedTour, settled, type AreasWorld, type Tour } from './support';

let tour: Tour;
let areas: AreasWorld;
let seed: CompareSeed;
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  tour = await seedTour();
  seed = await seedScenario('fp');
  areas = await createLaunchAreas(request);
});

const px = (page: Page, name: string) =>
  page.evaluate((n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)), name);

test.describe('1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Admin runs: the task pill sits inline with the run name', async ({ page }) => {
    await gotoApp(page, '/admin/runs');
    const cell = page.getByTestId('admin-run-cell').first();
    await expect(cell).toBeVisible();
    const link = (await cell.getByRole('link').boundingBox())!;
    const pill = cell.locator('> *').nth(1);
    await expect(pill).toBeVisible();
    const tag = (await pill.boundingBox())!;
    expect(Math.abs(link.y + link.height / 2 - (tag.y + tag.height / 2))).toBeLessThan(6);
    expect(tag.x).toBeGreaterThan(link.x + link.width - 1);
    expect((await cell.boundingBox())!.height).toBeLessThan(34);
  });

  test('Overview: recent runs carry task, dataset and model tags', async ({ page }) => {
    await gotoApp(page, `/projects/${tour.slug}/overview`);
    const card = page.getByRole('region', { name: 'Recent runs' });
    const tags = card.getByTestId('run-tags').first();
    await expect(tags).toBeVisible();
    await expect(card.getByTestId('run-task').first()).toBeVisible();
    const kinds = tags.locator('> *');
    expect(await kinds.count()).toBe(2);
    for (let i = 0; i < 2; i += 1) await expect(kinds.nth(i)).toBeVisible();
  });

  test('compare error cards are compact: the name, count and bar sit together', async ({ page }) => {
    const { base, a, b } = seed.runs;
    await page.goto(compareUrl([base, a, b], { panel: 'errors' }));
    await waitLoaded(page);
    const cards = page.getByTestId('error-card');
    await expect(cards.first()).toBeVisible();
    const box = (await cards.first().boundingBox())!;
    expect(box.width, 'a card keeps a compact column (about 420px at most)').toBeLessThanOrEqual(430);
    const row = cards.first().getByTestId('error-run').first();
    const name = (await row.locator('> *').first().boundingBox())!;
    const count = (await row.locator('> *').nth(1).boundingBox())!;
    const bar = (await row.locator('> *').nth(2).boundingBox())!;
    expect(count.x - (name.x + name.width), 'the count follows the name').toBeLessThan(box.width / 2);
    expect(bar.x).toBeGreaterThan(count.x);
    expect(bar.x + bar.width).toBeLessThan(box.x + box.width);
  });

  test('one card recipe: home cards, latency tiles, chart cards and the matrix table share the Card frame', async ({
    page,
  }) => {
    const frame = async (loc: ReturnType<Page['locator']>) =>
      loc.evaluate((el) => {
        const cs = getComputedStyle(el);
        const radius = getComputedStyle(document.documentElement).getPropertyValue('--radius-md').trim();
        return {
          radius: cs.borderTopLeftRadius,
          want: radius,
          border: cs.borderTopWidth,
          bg: cs.backgroundColor,
        };
      });
    // --bg-surface is #1a1a28 in the dark theme this suite runs in
    const surface = 'rgb(26, 26, 40)';
    // round 8b (owner decision H6): inside a report section panel a card is inset: --bg-elevated (#222232), same frame
    const inset = 'rgb(34, 34, 50)';
    const check = async (name: string, loc: ReturnType<Page['locator']>, want = surface) => {
      await expect(loc, name).toBeVisible();
      const f = await frame(loc);
      expect(f.radius, `${name} radius`).toBe(f.want);
      expect(f.border, `${name} outline`).toBe('1px');
      expect(f.bg, `${name} surface (want ${want})`).toBe(want);
    };
    await gotoApp(page, `/projects/${areas.slug}/experiments/new?env=${areas.envId}`);
    await check(
      'home start card',
      page.locator('[data-testid="launch-home"] > div').first().locator('> *').first(),
    );
    await gotoApp(page, `/projects/${areas.slug}/experiments/${areas.experimentId}`);
    await check('experiment matrix', page.locator('[data-exp-matrix]'));
    await gotoApp(page, `${runUrl(tour.slug, tour.runId)}?panel=latency`);
    await check(
      'latency tile',
      page.getByRole('region', { name: /LLM|Tool|Agent|Retriev|Chain|Other|Embedding|Guardrail/ }).first(),
      inset,
    );
    await gotoApp(page, `/projects/${tour.slug}/charts`);
    await check('chart card', page.locator('[data-testid^="chart-card-"]').first());
  });

  test('wizard settings step: one bottom bar of --bar-action-h with the step navigation inside', async ({
    page,
  }) => {
    await gotoApp(page, `/projects/${areas.slug}/experiments/new?env=${areas.envId}&step=settings`);
    await expect(page.getByRole('heading', { name: 'Environment configurations', level: 2 })).toBeVisible();
    const bar = page.getByRole('region', { name: 'Launch', exact: true });
    await expect(bar).toBeVisible();
    const want = await px(page, '--bar-action-h');
    const h = (await bar.boundingBox())!.height;
    expect(h).toBeGreaterThanOrEqual(want);
    expect(h).toBeLessThanOrEqual(want + 1);
    await expect(page.getByRole('navigation', { name: 'Step navigation' })).toHaveCount(1);
    await expect(bar.getByRole('navigation', { name: 'Step navigation' })).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Launch/ })).toBeVisible();
    await expect(bar.getByText(/runs? to launch/)).toBeVisible();
    // nothing else is stuck to the bottom edge above the bar: the only region at the foot is the bar
    const stuck = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        if (getComputedStyle(el).position !== 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom > window.innerHeight - 140 && r.top > window.innerHeight / 2)
          out.push(el.getAttribute('aria-label') ?? el.className);
      }
      return out;
    });
    expect(stuck, 'sticky elements in the bottom 140px').toHaveLength(1);
  });

  test('sweep: sections use the 18px H2 and the compare tabs rhythm', async ({ page }) => {
    const [a, b, c, d] = tour.compareIds as [string, string, string, string];
    await gotoApp(page, cohortUrl([a, b], [c, d], { tab: 'sweep' }));
    const sweep = page.getByTestId('sweep-view');
    await expect(sweep).toBeVisible({ timeout: 20_000 });
    await settled(page);
    const sizes = await sweep
      .locator('h2')
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).fontSize));
    // round 8 reduced the sweep to one titled section (the verdict) plus tables; the framed report sections are measured by r8b-sections
    expect(sizes.length).toBeGreaterThanOrEqual(1);
    expect(new Set(sizes)).toEqual(new Set(['18px']));
    const lead = async (sections: ReturnType<Page['locator']>) =>
      sections.evaluateAll((els) =>
        els.slice(1, 3).map((el, i) => {
          const h2 = el.querySelector('h2')!.getBoundingClientRect().top;
          return Math.round(h2 - els[i]!.getBoundingClientRect().bottom);
        }),
      );
    await gotoApp(page, compareUrl(tour.compareIds));
    await expect(page.getByTestId('item-list')).toBeVisible({ timeout: 20_000 });
    const compareLead = await lead(page.locator('[data-report-section]'));
    // the compare sections are panels now (round 8b): 20 px between panels, 1 px border and 14 px padding above the title = 35; the sweep view has no section with a head of its own any more
    for (const gap of compareLead) expect(Math.abs(gap - 35)).toBeLessThanOrEqual(1);
  });
});

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Overview: task and dataset stay, the model tag goes', async ({ page }) => {
    await gotoApp(page, `/projects/${tour.slug}/overview`);
    const tags = page.getByRole('region', { name: 'Recent runs' }).getByTestId('run-tags').first();
    await expect(tags).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Recent runs' }).getByTestId('run-task').first(),
    ).toBeVisible();
    await expect(tags.locator('> *').nth(0)).toBeVisible();
    await expect(tags.locator('> *').nth(1)).toBeHidden();
  });

  test('wizard: one --bar-action-h bar, the problems link lives in its overflow menu', async ({ page }) => {
    await gotoApp(page, `/projects/${areas.slug}/experiments/new?env=${areas.envId}&step=models`);
    await expect(page.getByRole('heading', { name: 'Models', level: 2 })).toBeVisible();
    const bar = page.getByRole('region', { name: 'Launch', exact: true });
    await expect(bar).toBeVisible();
    const want = await px(page, '--bar-action-h');
    const h = (await bar.boundingBox())!.height;
    expect(h).toBeGreaterThanOrEqual(want);
    expect(h).toBeLessThanOrEqual(want + 1);
    await expect(page.getByRole('navigation', { name: 'Step navigation' })).toHaveCount(1);
    await expect(bar.getByRole('button', { name: /^Fix \d+ problems? first/ })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'More launch options' })).toBeVisible();
  });
});
