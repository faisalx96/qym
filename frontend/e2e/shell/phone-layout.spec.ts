/**
 * 390px: nothing the user must reach is clipped by a card edge (final review F3), and a stat strip with an
 * odd tile count fills its last row instead of leaving an empty grey cell.
 */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';

test.use({ viewport: { width: 390, height: 844 } });

/** Controls whose right edge is past the viewport and that no deliberate horizontal scroller contains. */
async function clippedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const scrolls = (el: Element | null) => {
      for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
        const ox = getComputedStyle(n).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth) return true;
      }
      return false;
    };
    const out: string[] = [];
    document.querySelectorAll('main input, main button, main select, main table').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > vw + 0.5 && !scrolls(el)) {
        out.push(
          `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}" right=${Math.round(r.right)}`,
        );
      }
    });
    return out;
  });
}

test('Projects: the search and "New project" fit the viewport', async ({ page, request }) => {
  await createProject(request, 'Phone Landing', uniqueSlug('phone'));
  await gotoApp(page, '/');
  await expect(page.locator('[data-projects-page]')).toBeVisible();
  await expect(page.locator('[data-new-project]')).toBeVisible();
  expect(await clippedControls(page)).toEqual([]);
  const box = (await page.locator('[data-new-project]').boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('Project settings: the Name input and Save fit the card', async ({ page, request }) => {
  const p = await createProject(request, 'Phone Settings', uniqueSlug('phoneset'));
  await gotoApp(page, `/projects/${p.slug}/settings?tab=general`);
  const name = page.getByRole('textbox', { name: 'Project name' });
  await expect(name).toBeVisible();
  const card = (await name.locator('xpath=ancestor::section[1]').boundingBox())!;
  const input = (await name.boundingBox())!;
  expect(input.x + input.width).toBeLessThanOrEqual(card.x + card.width);
  const save = (await page.getByRole('button', { name: 'Save', exact: true }).boundingBox())!;
  expect(save.x + save.width).toBeLessThanOrEqual(card.x + card.width);
  expect(await clippedControls(page)).toEqual([]);
});

test('Admin users: the filter and the table stay inside the card', async ({ page }) => {
  await gotoApp(page, '/admin/users');
  const filter = page.getByRole('searchbox', { name: 'Filter users' });
  await expect(filter).toBeVisible();
  const box = (await filter.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await clippedControls(page)).toEqual([]);
});

test('stat strips fill their last row (Overview, Admin runs)', async ({ page, request }) => {
  const p = await createProject(request, 'Phone Overview', uniqueSlug('phoneov'));
  for (const path of [`/projects/${p.slug}/overview`, '/admin/runs']) {
    await gotoApp(page, path);
    const strip = page
      .getByRole('group')
      .filter({ has: page.locator('[data-variant]') })
      .first();
    await expect(strip).toBeVisible();
    const verdict = await strip.evaluate((el) => {
      const items = Array.from(el.children) as HTMLElement[];
      const w = el.getBoundingClientRect().width;
      const last = items[items.length - 1].getBoundingClientRect().width;
      return { count: items.length, lastIsFull: items.length % 2 === 0 || last >= w - 4 };
    });
    expect(verdict.lastIsFull, `${path}: ${verdict.count} tiles`).toBe(true);
  }
});
