/**
 * QA round, point 5 (spec QA5-1 to QA5-16): the dataset Settings tab after the spacing fix. Numbers are measured on the real page:
 * the content column is 1193 px at 1440, 777 at 1024 and 279 at 390.
 */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { ACCESS_GET, DATASET_GET, near, rewrite, size, WIDTHS } from './access-support';
import { bulkItems, createDataset, createVersion, publishVersion, sampleItems } from './support';

async function seed(request: Parameters<typeof createProject>[0]) {
  const project = await createProject(request, 'Settings layout', uniqueSlug('sl'));
  const d = await createDataset(request, project.slug, 'support-faq', {
    description: 'Customer support questions in Arabic and English.',
    tags: ['support', 'bilingual'],
  });
  const v = await createVersion(request, project.slug, d.slug);
  await bulkItems(request, project.slug, d.slug, v.version, sampleItems(6));
  await publishVersion(request, project.slug, d.slug, v.version, true);
  return { project, d };
}

const url = (s: { project: { slug: string }; d: { slug: string } }) =>
  `/projects/${s.project.slug}/datasets/${s.d.slug}?tab=settings&v=v1`;

async function open(page: Page, s: Awaited<ReturnType<typeof seed>>, width: number) {
  await page.setViewportSize({ width, height: 1200 });
  await gotoApp(page, url(s));
  await expect(page.getByTestId('settings-layout')).toBeVisible();
  await expect(page.getByTestId('settings-general')).toBeVisible();
}

// [width, column, general height, general width, visibility, danger, whole tab, input width]
const NUMBERS = [
  [1440, 1193, 354.9, 819, [360, 165.3], [360, 152.7], 354.9, 629],
  [1024, 777, 354.9, 777, [777, 134.5], [777, 137.3], 654.6, 587],
  [390, 279, 428.4, 279, [279, 180.6], [279, 168.1], 805.1, 223],
] as const;

for (const [width, column, generalH, generalW, vis, danger, whole, inputW] of NUMBERS) {
  test(`boxes at ${width}px (QA5-1, QA5-2, QA5-5 to QA5-9)`, async ({ page, request }) => {
    const s = await seed(request);
    await open(page, s, width);
    const layout = await size(page.getByTestId('settings-layout'));
    near(layout.w, column, 0.6);
    near(layout.h, whole, 0.6);
    const general = await size(page.getByTestId('settings-general'));
    near(general.w, generalW, 0.6);
    near(general.h, generalH, 0.6);
    const visibility = await size(page.getByTestId('settings-visibility'));
    near(visibility.w, vis[0], 0.6);
    near(visibility.h, vis[1], 0.6);
    const dz = await size(page.getByTestId('settings-danger'));
    near(dz.w, danger[0], 0.6);
    near(dz.h, danger[1], 0.6);
    // QA5-6: the inputs
    const name = await size(page.getByRole('textbox', { name: 'Name' }));
    near(name.w, inputW, 0.6);
    expect(name.h).toBe(24);
    near((await size(page.getByRole('textbox', { name: 'Description' }))).h, 72, 0.6);
    // QA5-1: no empty space on the right at 1440 (form + gap + side column fill the column)
    if (width === 1440) {
      const boxes = await page.evaluate(() => {
        const r = (id: string) => document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect();
        return { layout: r('settings-layout'), general: r('settings-general'), side: r('settings-danger') };
      });
      near(boxes.side.right, boxes.layout.right, 0.5);
      near(boxes.general.right + 14, boxes.side.left, 0.5);
      expect(layout.w - general.w - 14 - dz.w).toBeLessThan(1); // 0 px empty (was 433)
    } else {
      // one column: Visibility and Danger zone sit under General
      const ys = await page.evaluate(() =>
        ['settings-general', 'settings-visibility', 'settings-danger'].map(
          (id) => document.querySelector(`[data-testid=${id}]`)!.getBoundingClientRect().top,
        ),
      );
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
    }
    // QA5-16: never scrolls horizontally
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.getByTestId('settings-layout').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  });
}

test('card titles start 15 px below the card top and descriptions are never cut (QA5-3, QA5-4)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  for (const width of WIDTHS) {
    await open(page, s, width);
    for (const id of ['settings-general', 'settings-visibility', 'settings-danger']) {
      const gap = await page.getByTestId(id).evaluate((card) => {
        const h2 = card.querySelector('h2')!;
        return h2.getBoundingClientRect().top - card.getBoundingClientRect().top;
      });
      near(gap, 15, 0.6);
    }
    const head = await size(page.getByTestId('settings-general').getByTestId('card-head'));
    expect(head.h).toBeLessThan(25);
    for (const id of ['settings-visibility', 'settings-danger']) {
      const paragraph = page.getByTestId(id).getByTestId('card-head').locator('p');
      const cut = await paragraph.evaluate((p) => ({
        fits: p.scrollWidth <= p.clientWidth,
        ellipsis: getComputedStyle(p).textOverflow === 'ellipsis',
      }));
      expect(cut).toEqual({ fits: true, ellipsis: false });
    }
    const d = await page
      .getByTestId('settings-danger')
      .getByTestId('card-head')
      .locator('p')
      .evaluate((p) => p.getBoundingClientRect().height);
    near(d, width === 1440 ? 46.2 : width === 1024 ? 30.8 : 61.6, 0.6);
  }
});

test('the General rows: label column and row heights at 1440 (QA5-5)', async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s, 1440);
  const xs: number[] = [];
  for (const name of ['Name', 'Description', 'Tags']) {
    const box = await page.getByRole('textbox', { name, exact: true }).boundingBox();
    xs.push(Math.round(box!.x));
  }
  // label column 120 + gap 14: the body starts at the same x for every row
  expect(new Set(xs).size).toBe(1);
  const card = await page.getByTestId('settings-general').boundingBox();
  near(xs[0]! - card!.x, 1 + 20 + 120 + 14, 1); // border, --card-padding inline (20), label column, gap
  await expect(page.getByText('Press Enter to add a tag.')).toBeVisible();
});

test('Save changes, status text and the footer (QA5-10, QA5-15)', async ({ page, request }) => {
  const s = await seed(request);
  await open(page, s, 1440);
  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeDisabled();
  await expect(page.getByText('No changes')).toBeVisible();
  near((await size(save)).h, 24, 0.6);
  await page.getByRole('textbox', { name: 'Description' }).fill('A new description.');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await save.click();
  await expect(page.locator('[data-toast-container]').getByText('Settings saved')).toBeVisible();
  await expect(page.getByText('No changes')).toBeVisible();
});

test('without the Visibility card the Danger zone holds the side column alone (QA5-13)', async ({
  page,
  request,
}) => {
  const s = await seed(request);
  await rewrite(page, DATASET_GET, (b) => {
    b.dataset.can_set_private_test_set = false;
  });
  await open(page, s, 1440);
  await expect(page.getByTestId('settings-visibility')).toHaveCount(0);
  const dz = await size(page.getByTestId('settings-danger'));
  near(dz.w, 360, 0.6);
  near(dz.h, 152.7, 0.6);
  near((await size(page.getByTestId('settings-general'))).w, 819, 0.6);
});

test('the Settings tab makes no request to the access route (QA5-14)', async ({ page, request }) => {
  const s = await seed(request);
  const hits: string[] = [];
  page.on('request', (r) => {
    if (ACCESS_GET.test(r.url())) hits.push(r.url());
  });
  await open(page, s, 1440);
  await page.waitForTimeout(2500); // past the idle prefetch window
  expect(hits).toEqual([]);
  await expect(page.getByTestId('access-section')).toHaveCount(0);
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
});

test('a reader has read-only fields and no footer (QA5-10, QA5-11)', async ({ page, request }) => {
  const s = await seed(request);
  await rewrite(page, DATASET_GET, (b) => {
    Object.assign(b.dataset.permissions, { can_modify: false, can_delete: false, access_level: 'view' });
  });
  await open(page, s, 1440);
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(page.getByTestId('private-toggle')).toBeDisabled();
  await expect(
    page.getByText('Only the dataset creator or a project manager can delete a dataset.'),
  ).toBeVisible();
});
