/** WP-B: the Latency-sensitive tag and filter in the experiments list and the queue (spec-b B5-59 to B5-68). */
import { expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_A,
  FAKE_B,
  createEnvironment,
  expPath,
  experimentSpec,
  launchExperiment,
  resetFakes,
  seedProject,
  test,
  waitForSubmitted,
  pageOverflow,
} from './support';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
});

async function seed(request: Parameters<typeof seedProject>[0]) {
  const { project, connectionId } = await seedProject(request, 'lat-list');
  const env = await createEnvironment(request, project.id, 'staging', { port: FAKE_A });
  const flagged = await launchExperiment(request, project.id, {
    name: 'urgent',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId),
    latency_sensitive: true,
  });
  const plain = await launchExperiment(request, project.id, {
    name: 'ordinary',
    environment_ids: [env.id],
    spec: experimentSpec(connectionId),
  });
  await waitForSubmitted(request, project.id, flagged.id);
  return { project, env, flagged, plain, connectionId };
}

test('the list tags flagged experiments and filters them from the URL', async ({ page, request }) => {
  const { project } = await seed(request);
  await gotoApp(page, expPath(project.slug));
  const grid = page.getByRole('grid', { name: 'Experiments' });
  await expect(grid.getByRole('row')).toHaveCount(3);
  await expect(grid.getByTestId('latency-tag')).toHaveCount(1);
  await expect(grid.getByRole('row').filter({ hasText: 'urgent' }).getByTestId('latency-tag')).toBeVisible();
  const tag = await grid.getByTestId('latency-tag').boundingBox();
  expect(Math.round(tag!.width * 10) / 10).toBeCloseTo(98.4, 0);
  expect(Math.round(tag!.height)).toBe(20);

  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await expect(page).toHaveURL(/latency=1/);
  await expect(grid.getByRole('row')).toHaveCount(2);
  await expect(grid).not.toContainText('ordinary');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Latency-sensitive only' })).toBeChecked();
  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await expect(page).not.toHaveURL(/latency=1/);
  expect(await pageOverflow(page)).toBe('');
});

test('the queue tags flagged jobs, filters them and warns that others wait', async ({ page, request }) => {
  const { project } = await seed(request);
  await gotoApp(page, expPath(project.slug, '/queue'));
  await expect(page.getByTestId('latency-tag').first()).toBeVisible();
  const note = page.getByTestId('queue-latency-note');
  await expect(note).toHaveText('A latency-sensitive job is active on staging. Other jobs wait until it finishes.');
  expect(Math.round((await note.boundingBox())!.height * 10) / 10).toBeCloseTo(25.4, 0);
  await page.locator('label').filter({ hasText: 'Latency-sensitive only' }).click();
  await expect(page).toHaveURL(/latency=1/);
  const grid = page.getByRole('grid', { name: 'Queued jobs in dispatch order' });
  await expect(grid.getByText('ordinary')).toHaveCount(0);
  await expect(grid.getByText('urgent').first()).toBeVisible();
});

test('the queue note measures the amended heights at the three widths (B5-65)', async ({ page, request }) => {
  const { project } = await seed(request);
  // Two active environments: their cards sit side by side at 1024 (381.5 px each), as in the review.
  await createEnvironment(request, project.id, 'production', { port: FAKE_B });
  const heights: Record<number, number> = {};
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, expPath(project.slug, '/queue'));
    const note = page.getByTestId('queue-latency-note');
    await expect(note).toBeVisible();
    heights[width] = Math.round((await note.boundingBox())!.height * 10) / 10;
  }
  console.log('B5-65 heights', JSON.stringify(heights));
  // Amended: 25.4 at 1440, 40.8 at 1024 (the sentence wraps in the 381.5 px card), 40.8 at 390.
  expect(heights[1440]).toBe(25.4);
  expect(heights[1024]).toBe(40.8);
});

test('the list tag keeps its numbers at three widths and never changes a row height (QA3-34, QA3-36, QA3-37)', async ({
  page,
  request,
}) => {
  const { project } = await seed(request);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, expPath(project.slug));
    // Below 760 px the list is a card layout (no grid role): the tag is looked up on the page.
    const tag = page.getByTestId('latency-tag');
    await expect(tag).toHaveCount(1);
    await expect(tag).toHaveText('Latency-sensitive');
    await expect(tag).toHaveAttribute('data-tone', 'info');
    const look = await tag.evaluate((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return [Math.round(r.width * 10) / 10, Math.round(r.height), s.fontSize, s.fontWeight];
    });
    expect(look).toEqual([98.4, 20, '10px', '650']);
    if (width > 760) {
      const grid = page.getByRole('grid', { name: 'Experiments' });
      // Optional content never changes geometry: flagged and plain rows are both 40 px.
      const heights = await grid
        .getByRole('row')
        .evaluateAll((rows) => rows.slice(1).map((r) => Math.round(r.getBoundingClientRect().height)));
      expect(heights).toEqual([40, 40]);
      const filter = await page.getByTestId('filter-latency').boundingBox();
      expect([Math.round(filter!.width * 10) / 10, Math.round(filter!.height * 10) / 10]).toEqual([141.9, 16.8]);
    }
    expect(await pageOverflow(page)).toBe('');
  }
});

test('a long name wraps beside its tag instead of being clipped (QA3-35)', async ({ page, request }) => {
  const { project, env, connectionId } = await seed(request);
  const long = 'nightly regression of the support agent on staging';
  await launchExperiment(request, project.id, {
    name: long,
    environment_ids: [env.id],
    spec: experimentSpec(connectionId),
    latency_sensitive: true,
    description: 'weekly check',
  });
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoApp(page, expPath(project.slug));
    const tags = page.getByTestId('latency-tag');
    await expect(tags.first()).toBeVisible();
    const cell = page.getByText(long).locator('xpath=ancestor::*[contains(@class,"twoLine")][1]');
    await expect(cell).toBeVisible();
    const m = await cell.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const name = el.querySelector('span span') as HTMLElement;
      const td = el.closest('td,li') as HTMLElement;
      return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, fits: name.scrollWidth <= name.clientWidth, td: td.getBoundingClientRect().height };
    });
    console.log('QA3-35', width, JSON.stringify(m));
    expect(m.fits).toBe(true);
    if (width === 1440) {
      expect(m.w).toBe(204); // the 220 px cell minus its 8 px padding
      expect(Math.abs(m.td - 73.9)).toBeLessThanOrEqual(2);
      const rows = await page.getByRole('grid', { name: 'Experiments' }).getByRole('row').evaluateAll((r) => r.slice(1).map((x) => Math.round(x.getBoundingClientRect().height)));
      expect(rows.filter((h) => h === 40).length).toBe(rows.length - 1);
      await page.screenshot({ path: '../docs/internal/feature-rounds/2026-10-qa-feedback/shots/after-qb-list-wrap-1440.png' });
    }
    expect(await pageOverflow(page)).toBe('');
  }
});
