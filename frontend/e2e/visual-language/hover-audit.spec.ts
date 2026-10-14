/**
 * Dead-clickable audit (redesign 2, "every actionable thing answers"): for every outermost cursor:pointer element in
 * the viewport at several scroll steps, the pixels of its box must change on a real pointer hover, unless the
 * control is in a selected state. Elements are identified as `<page> <tag>.<css-module class stem>`.
 * PENDING lists known dead clickables owned by an area application (A1 to A3); it may only shrink (an entry that
 * no longer appears is removed by hand: which samples are on screen depends on the seeded data).
 */
import { expect, test, type Page } from '@playwright/test';
import { compareUrl } from '../compare/support';
import { gotoApp } from '../helpers';
import { runUrl } from '../run-detail/support';
import { createLaunchAreas, seedTour, settled, type AreasWorld, type Tour } from './support';

/** Dead on hover today, fixed by the area application that owns the page. */
const PENDING = new Set<string>([
  // compare (A3): run segments, distribution bars and matrix row buttons
  'compare button._seg',
  'compare button._distBar',
  'compare button._rowButton',
  'compare button._errorCard',
]);

let tour: Tour;
let areas: AreasWorld;
test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  tour = await seedTour();
  areas = await createLaunchAreas(request);
});

interface Candidate {
  key: string;
  box: { x: number; y: number; width: number; height: number };
}

async function candidates(page: Page, name: string): Promise<Candidate[]> {
  return page.evaluate((pageName) => {
    const out: { key: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    const seen = new Set<string>();
    const all = Array.from(document.querySelectorAll<HTMLElement>('body *'));
    for (const el of all) {
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      const parent = el.parentElement;
      if (parent && getComputedStyle(parent).cursor === 'pointer') continue; // outermost only
      if (el.closest('[disabled], [aria-disabled="true"], [data-disabled]')) continue;
      // selected controls legitimately keep their look on hover
      if (
        el.closest(
          '[aria-selected="true"], [aria-pressed="true"], [aria-current], [data-selected], [aria-checked="true"], [aria-expanded="true"]',
        )
      )
        continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
      const stem = (
        el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : ''
      )!.replace(/_[a-z0-9]{5,8}_\d+$/i, '');
      const label = stem
        ? ''
        : `[${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 24)}]`;
      const key = `${pageName} ${el.tagName.toLowerCase()}.${stem}${label}`;
      // an element covered by something else (a sticky header) cannot be hovered at its centre
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!top || !(el === top || el.contains(top))) continue;
      // one sample per kind per viewport: the first, fully visible one
      if (seen.has(key)) continue;
      if (r.top < 0 || r.bottom > window.innerHeight) continue;
      seen.add(key);
      el.setAttribute('data-vl-audit', key);
      out.push({ key, box: { x: r.x, y: r.y, width: r.width, height: r.height } });
    }
    return out;
  }, name);
}

async function audit(page: Page, name: string, steps: number): Promise<string[]> {
  const dead = new Set<string>();
  const checked = new Set<string>();
  for (let step = 0; step < steps; step += 1) {
    await page.evaluate((s) => {
      const scrollers = Array.from(document.querySelectorAll<HTMLElement>('*')).filter(
        (e) =>
          e.scrollHeight > e.clientHeight + 50 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowY),
      );
      const main = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (main) main.scrollTop = s * Math.round(window.innerHeight * 0.8);
    }, step);
    await settled(page);
    await page.mouse.move(0, 0);
    for (const c of await candidates(page, name)) {
      if (checked.has(c.key)) continue;
      checked.add(c.key);
      const clip = {
        x: Math.max(0, c.box.x - 2),
        y: Math.max(0, c.box.y - 2),
        width: c.box.width + 4,
        height: c.box.height + 4,
      };
      const before = await page.screenshot({ clip });
      await page.mouse.move(c.box.x + c.box.width / 2, c.box.y + c.box.height / 2);
      await settled(page);
      const after = await page.screenshot({ clip });
      await page.mouse.move(0, 0);
      await settled(page);
      if (Buffer.compare(before, after) === 0) dead.add(c.key);
    }
  }
  return [...dead];
}

function check(name: string, dead: string[]) {
  const unexpected = dead.filter((k) => !PENDING.has(k));
  expect(unexpected, `${name}: clickables that do not react to hover`).toEqual([]);
}

test.describe('hover audit', () => {
  test.setTimeout(240_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('runs list', async ({ page }) => {
    await gotoApp(page, `/projects/${tour.slug}`);
    await settled(page);
    check('runs', await audit(page, 'runs', 3));
  });

  test('run detail', async ({ page }) => {
    await gotoApp(page, runUrl(tour.slug, tour.runId));
    await expect(page.getByTestId('items-count')).toBeVisible();
    check('run', await audit(page, 'run', 8));
  });

  test('compare', async ({ page }) => {
    await gotoApp(page, compareUrl(tour.compareIds));
    await expect(page.getByTestId('item-list')).toBeVisible({ timeout: 20_000 });
    check('compare', await audit(page, 'compare', 6));
  });

  const areaPages: {
    name: string;
    path: () => string;
    ready: (page: Page) => Promise<void>;
    steps?: number;
  }[] = [
    {
      name: 'experiments',
      path: () => `/projects/${areas.slug}/experiments`,
      ready: (p) => expect(p.locator('[data-experiments-list]')).toBeVisible(),
    },
    {
      name: 'experiment-detail',
      path: () => `/projects/${areas.slug}/experiments/${areas.experimentId}`,
      ready: (p) => expect(p.locator('[data-exp-matrix]')).toBeVisible(),
    },
    {
      name: 'launch-home',
      path: () => `/projects/${areas.slug}/experiments/new?env=${areas.envId}`,
      ready: (p) => expect(p.getByRole('textbox', { name: 'Experiment name' })).toBeVisible(),
    },
    ...(['where', 'start', 'models', 'settings', 'evaluation', 'review'] as const).map((step) => ({
      name: `wizard-${step}`,
      path: () => `/projects/${areas.slug}/experiments/new?env=${areas.envId}&step=${step}`,
      ready: (p: Page) => expect(p.getByRole('heading', { level: 2 }).first()).toBeVisible(),
    })),
    {
      name: 'datasets',
      path: () => `/projects/${areas.slug}/datasets`,
      ready: (p) => expect(p.locator('[data-dataset-card]').first()).toBeVisible(),
    },
    ...(['items', 'runs', 'lineage', 'settings'] as const).map((tab) => ({
      name: `dataset-${tab}`,
      path: () => `/projects/${areas.slug}/datasets/${areas.datasetSlug}?v=v1&tab=${tab}`,
      ready: (p: Page) => expect(p.getByRole('tab', { selected: true }).first()).toBeVisible(),
    })),
    ...(['runs', 'projects', 'users', 'maintenance'] as const).map((tab) => ({
      name: `admin-${tab}`,
      path: () => `/admin/${tab}`,
      ready: (p: Page) => expect(p.getByRole('tab', { selected: true }).first()).toBeVisible(),
    })),
    {
      name: 'analysis',
      path: () => `/projects/${areas.analysisSlug}/analysis?run=${areas.runId}`,
      ready: (p) => expect(p.getByRole('region', { name: 'Analysis actions' })).toBeVisible(),
    },
    {
      name: 'reviews',
      path: () => `/projects/${areas.slug}/reviews?status=all`,
      ready: (p) => expect(p.getByRole('main')).toBeVisible(),
    },
    {
      name: 'settings',
      path: () => `/projects/${areas.slug}/settings`,
      ready: (p) => expect(p.getByRole('main')).toBeVisible(),
    },
  ];
  for (const area of areaPages) {
    test(`${area.name}`, async ({ page }) => {
      await gotoApp(page, area.path());
      await area.ready(page);
      check(area.name, await audit(page, area.name, area.steps ?? 3));
    });
  }

  test('the Export HTML link answers hover and press', async ({ page }) => {
    await gotoApp(page, runUrl(tour.slug, tour.runId));
    const link = page.getByRole('link', { name: /Export HTML/ });
    await expect(link).toBeVisible();
    const bg = () => link.evaluate((el) => getComputedStyle(el).backgroundColor);
    const rest = await bg();
    await link.hover();
    await expect.poll(bg).not.toBe(rest);
    const hover = await bg();
    await page.mouse.down();
    await expect.poll(bg).not.toBe(hover);
    await page.mouse.up();
  });
});
