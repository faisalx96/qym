/**
 * QA round, general note 1 (spec QG1-1 to QG1-16): a link that is a box (card, boxed button, link with tags) never
 * underlines on hover; running-text links keep it. Every surface is hovered with a real pointer and the computed
 * `textDecorationLine` is read from the anchor (and from the texts inside it), together with the hover treatment.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { createDataset, createVersion, ingestRun, publishVersion, bulkItems, sampleItems, createApiKey } from '../datasets/support';
import { createLaunchAreas, type AreasWorld } from './support';
import { waitForDashboardRuns } from '../experiments/support';
import { runUrl } from '../run-detail/support';

const deco = (el: Locator) => el.evaluate((e) => getComputedStyle(e).textDecorationLine);
const decoInside = (el: Locator) =>
  el.evaluate((e) =>
    [e, ...Array.from(e.querySelectorAll('*'))].map((n) => getComputedStyle(n).textDecorationLine).filter((d) => d !== 'none'),
  );

async function hovered(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded();
  await el.hover();
  await page.waitForTimeout(160); // past the 120 ms colour transitions
}

const style = (el: Locator) =>
  el.evaluate((e) => {
    const cs = getComputedStyle(e);
    return { border: cs.borderTopColor, fill: cs.backgroundColor, shadow: cs.boxShadow, transform: cs.transform };
  });

test.describe('block links never underline (QG1-1, QG1-2, QG1-4, QG1-5)', () => {
  for (const width of [1440, 390]) {
    test(`projects page and datasets catalog cards at ${width}px`, async ({ page, request }) => {
      const project = await createProject(request, 'Link cards', uniqueSlug('lnk'));
      const d = await createDataset(request, project.slug, 'refund-cases', { description: 'Edge cases for refunds.' });
      const v = await createVersion(request, project.slug, d.slug);
      await bulkItems(request, project.slug, d.slug, v.version, sampleItems(6));
      await publishVersion(request, project.slug, d.slug, v.version, true);
      await page.setViewportSize({ width, height: 900 });

      await gotoApp(page, '/');
      const card = page.locator(`a[data-project-card="${project.slug}"], a[data-project-card]`).first();
      await expect(card).toBeVisible();
      const before = await style(card);
      expect(await deco(card)).toBe('none');
      await hovered(page, card);
      expect(await decoInside(card)).toEqual([]); // QG1-1: none of the 8 texts underlines
      const after = await style(card);
      expect(after.border).not.toBe(before.border); // the Card hover treatment stays
      expect(after.fill).not.toBe(before.fill);
      expect(after.shadow).not.toBe('none');
      expect(after.transform).toBe('none');

      await gotoApp(page, `/projects/${project.slug}/datasets`);
      const dataset = page.locator('a[data-dataset-card]').first();
      await expect(dataset).toBeVisible();
      const beforeDs = await style(dataset);
      await hovered(page, dataset);
      expect(await decoInside(dataset)).toEqual([]); // QG1-2
      const afterDs = await style(dataset);
      expect(afterDs.border).not.toBe(beforeDs.border);
      expect(afterDs.fill).not.toBe(beforeDs.fill);
      expect(afterDs.shadow).not.toBe('none');
      await expect(dataset).toHaveAttribute('data-link', 'block'); // QG1-3 in the product
      await expect(card).toHaveAttribute('data-link', 'block').catch(() => undefined);
    });
  }

  for (const width of [1440, 390]) {
    test(`docs previous / next at ${width}px (QG1-4)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, '/docs/get-started/what-is-qym');
      const nav = page.getByRole('navigation', { name: 'Previous and next page' });
      await nav.scrollIntoViewIfNeeded();
      const links = nav.getByRole('link');
      expect(await links.count()).toBeGreaterThan(0);
      for (let i = 0; i < (await links.count()); i += 1) {
        const link = links.nth(i);
        await expect(link).toHaveAttribute('data-link', 'block');
        const before = await style(link);
        await hovered(page, link);
        expect(await decoInside(link)).toEqual([]);
        expect((await style(link)).fill).not.toBe(before.fill); // the Button hover fill stays
      }
    });
  }

  test('run page dataset link keeps its colour change and never underlines (QG1-5)', async ({ page, request }) => {
    const project = await createProject(request, 'Run link', uniqueSlug('rl'));
    const key = await createApiKey(request, project.id);
    const d = await createDataset(request, project.slug, 'Legal clauses');
    const v = await createVersion(request, project.slug, d.slug);
    const items = sampleItems(6);
    await bulkItems(request, project.slug, d.slug, v.version, items);
    await publishVersion(request, project.slug, d.slug, v.version, true);
    const run = await ingestRun(request, {
      apiKey: key,
      task: 'faq',
      runName: 'link run',
      dataset: d,
      version: { ...v, status: 'published' },
      items,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, runUrl(project.slug, run.id));
    const link = page.locator('a[class*="metaLink"]').filter({ hasText: 'Legal clauses' }).first();
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('data-link', 'block');
    const colour = await link.evaluate((e) => getComputedStyle(e).color);
    await hovered(page, link);
    expect(await decoInside(link)).toEqual([]);
    expect(await link.evaluate((e) => getComputedStyle(e).color)).not.toBe(colour);
  });
});

test.describe('running text keeps its underline; link buttons stay as they were (QG1-7, QG1-8)', () => {
  test('docs article links and the runs list run name underline on hover', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, '/docs/get-started/what-is-qym');
    const inline = page.locator('article a, [class*="article"] a').filter({ hasNot: page.locator('[data-link="block"]') }).first();
    await expect(inline).toBeVisible();
    await hovered(page, inline);
    expect(await deco(inline)).toBe('underline');

    const project = await createProject(request, 'Plain links', uniqueSlug('pl'));
    const key = await createApiKey(request, project.id);
    const d = await createDataset(request, project.slug, 'Legal clauses');
    const v = await createVersion(request, project.slug, d.slug);
    const items = sampleItems(6);
    await bulkItems(request, project.slug, d.slug, v.version, items);
    await publishVersion(request, project.slug, d.slug, v.version, true);
    await ingestRun(request, { apiKey: key, task: 'faq', runName: 'plain run', dataset: d, version: { ...v, status: 'published' }, items });
    await waitForDashboardRuns(request, project.slug, 1, 'faq', 'Legal clauses');
    await gotoApp(page, `/projects/${project.slug}/runs?origin=all`);
    const name = page.locator('a[class*="runName"]').first();
    await expect(name).toBeVisible();
    await hovered(page, name);
    expect(await deco(name)).toBe('underline');
    // QG1-8: a link button never underlines
    await gotoApp(page, `/projects/${project.slug}/datasets`);
    const lb = page.locator('a[class*="button"]').first();
    if ((await lb.count()) > 0) {
      await hovered(page, lb);
      expect(await deco(lb)).toBe('none');
    }
  });
});

test.describe('experiments surfaces (QG1-6, QG1-10)', () => {
  let areas: AreasWorld;
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    areas = await createLaunchAreas(request);
  });

  for (const width of [1440, 390]) {
    test(`the "copy an experiment" start card is a block link at ${width}px (QG1-6)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoApp(page, `/projects/${areas.slug}/experiments/new?env=${areas.envId}&step=start`);
      const card = page.locator('a[data-link="block"]').filter({ hasText: 'Copy an experiment' }).first();
      await expect(card).toBeVisible();
      const before = await style(card);
      await hovered(page, card);
      expect(await decoInside(card)).toEqual([]);
      const after = await style(card);
      expect(after.border).not.toBe(before.border);
      expect(after.fill).not.toBe(before.fill);
    });
  }

  test('experiments and environments rows are not anchors and never underline (QG1-10)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoApp(page, `/projects/${areas.slug}/experiments`);
    const row = page.getByRole('row').nth(1);
    await expect(row).toBeVisible();
    await hovered(page, row);
    expect(await deco(row)).toBe('none');
    expect(await row.locator('a').count()).toBe(0);
    const nameButton = row.getByRole('button').first();
    if ((await nameButton.count()) > 0) expect(await deco(nameButton)).toBe('none');
    await gotoApp(page, `/projects/${areas.slug}/experiments/environments`);
    const envRow = page.getByRole('row').nth(1);
    if ((await envRow.count()) > 0) {
      await hovered(page, envRow);
      expect(await deco(envRow)).toBe('none');
    }
  });
});

test.describe('the rule is in the stylesheet (QG1-9, QG1-11)', () => {
  test('no anchor with two or more texts or a box underlines on hover on the main surfaces', async ({ page, request }) => {
    const project = await createProject(request, 'Inventory', uniqueSlug('inv'));
    const d = await createDataset(request, project.slug, 'inv-data');
    const v = await createVersion(request, project.slug, d.slug);
    await bulkItems(request, project.slug, d.slug, v.version, sampleItems(4));
    await publishVersion(request, project.slug, d.slug, v.version, true);
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ['/', `/projects/${project.slug}/datasets`, '/docs/get-started/what-is-qym']) {
      await gotoApp(page, path);
      await page.waitForTimeout(400);
      const anchors = await page.locator('a').evaluateAll((els) =>
        els.map((a, i) => {
          const cs = getComputedStyle(a);
          const r = a.getBoundingClientRect();
          const inView = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && !a.className.includes('skip');
          const texts = Array.from(a.querySelectorAll('*')).filter((n) => n.children.length === 0 && (n.textContent ?? '').trim()).length;
          const boxed = cs.borderTopWidth !== '0px' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent');
          return { i, texts, boxed, block: a.getAttribute('data-link') === 'block', btn: a.className.includes('button'), visible: inView && r.width > 0 };
        }),
      );
      for (const a of anchors.filter((x) => x.visible && (x.texts >= 2 || x.boxed) && !x.btn)) {
        const link = page.locator('a').nth(a.i);
        await hovered(page, link);
        expect(await decoInside(link), `${path} anchor #${a.i} (block=${a.block})`).toEqual([]);
      }
    }
  });
});
