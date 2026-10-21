/**
 * QA-B point 3, Runs page (spec-b QA3-25 to QA3-33): runs that came from a latency-sensitive experiment carry a
 * 20 x 20 clock tag in the leading slot of the Run cell. 0 px added: the name keeps its x and width, the frozen
 * columns do not move. Seeded through the public API (launchExperiment + linkRunToJob).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  createApiKey,
  createEnvironment,
  describeViolations,
  experimentSpec,
  ingestRun,
  launchExperiment,
  linkRunToJob,
  resetFakes,
  seedProject,
  test,
  waitForSubmitted,
} from '../experiments/support';
import { dataRows, openRuns } from './support';
import { waitForProjection } from './seed';

test.setTimeout(150_000);
test.use({ actionTimeout: 10_000 });

const NAME = 'prompt sweep · timeout=10';
const round = (n: number) => Math.round(n * 10) / 10;

async function seed(request: Parameters<typeof seedProject>[0]) {
  await resetFakes(request);
  const { project, connectionId } = await seedProject(request, 'runs-tag');
  const env = await createEnvironment(request, project.id, 'staging');
  const key = await createApiKey(request, project.id);
  const spec = experimentSpec(connectionId);
  const flagged = await launchExperiment(request, project.id, {
    name: 'latency check',
    environment_ids: [env.id],
    spec,
    latency_sensitive: true,
  });
  const plain = await launchExperiment(request, project.id, { name: 'nightly baseline', environment_ids: [env.id], spec });
  const a = await waitForSubmitted(request, project.id, flagged.id);
  const b = await waitForSubmitted(request, project.id, plain.id);
  await linkRunToJob(request, key, a.jobs[0]!, flagged.id, NAME);
  await linkRunToJob(request, key, b.jobs[0]!, plain.id, NAME + ' ');
  await ingestRun(request, key, { name: 'local run' });
  await waitForProjection(request, project.slug, 3);
  return { project };
}

const tag = (l: Page | Locator) => l.getByTestId('run-latency-tag');

test.describe('Runs page latency tag', () => {
  for (const width of [1440, 1024] as const) {
    test(`one tag on the flagged row only, 20 x 20, name unmoved at ${width}px (QA3-25, QA3-26, QA3-27, QA3-29)`, async ({
      page,
      request,
    }) => {
      const { project } = await seed(request);
      await page.setViewportSize({ width, height: 900 });
      await openRuns(page, project.slug);
      await expect(dataRows(page)).toHaveCount(3);
      await expect(tag(page.getByTestId('runs-table'))).toHaveCount(1);
            const flaggedRow = dataRows(page).filter({ has: tag(page) });
      await expect(flaggedRow).toHaveCount(1);
      const t = tag(flaggedRow);
      await expect(t).toHaveAttribute('role', 'img');
      await expect(t).toHaveAttribute('aria-label', 'Latency-sensitive experiment');
      await expect(t).toHaveAttribute('title', 'Latency-sensitive experiment');
      await expect(t).toHaveAttribute('data-tone', 'info');
      expect(await t.evaluate((el) => el.getAttribute('tabindex'))).toBeNull();
      const tb = (await t.boundingBox())!;
      expect([round(tb.width), round(tb.height)]).toEqual([20, 20]);
      // The tag sits in the 24 px leading slot, centred, and ends before the name.
      const cell = flaggedRow.locator('td[data-col="run"]');
      const cb = (await cell.boundingBox())!;
      const nameLink = flaggedRow.getByTestId('run-cell').locator('a');
      const nb = (await nameLink.boundingBox())!;
      expect(tb.x + tb.width).toBeLessThanOrEqual(nb.x);
      // Same-length name without the tag (the plain run's name differs by a trailing space only).
      const plainRow = dataRows(page).filter({ hasText: 'nightly baseline' }).or(dataRows(page).filter({ hasText: NAME })).filter({ hasNot: tag(page) });
      const other = plainRow.first().getByTestId('run-cell').locator('a');
      const ob = (await other.boundingBox())!;
      console.log('QA3-26', width, 'tag', JSON.stringify(tb), 'name', round(nb.x), round(nb.width), 'plain', round(ob.x), round(ob.width), 'cell', round(cb.width));
      expect(round(nb.x)).toBe(round(ob.x));
      expect(round(nb.width)).toBe(round(ob.width));
      expect(await nameLink.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      // QA3-27: geometry that must not move.
      const geometry = await page.getByTestId('runs-table').evaluate((root) => {
        const th = (col: string) => root.querySelector(`th[data-col="${col}"]`)?.getBoundingClientRect().width ?? 0;
        const scroller = root.querySelector('[data-dt-scroller]') as HTMLElement;
        const row = root.querySelector('tbody tr[data-run-id]')!.getBoundingClientRect().height;
        return { run: th('run'), row, scroll: scroller.scrollWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      console.log('QA3-27', width, JSON.stringify(geometry));
      expect(geometry.run).toBe(260);
      expect(geometry.row).toBe(32);
      expect(geometry.page).toBe(0);
      if (width === 1440) expect(geometry.scroll).toBe(2634);
      // Local runs carry none.
      await expect(tag(dataRows(page).filter({ hasText: 'local run' }))).toHaveCount(0);
      expect(describeViolations(await axeSeriousViolations(page))).toBe('');
    });
  }

  test('card layout at 390px: the tag leads the head, head and cards keep their size (QA3-30)', async ({
    page,
    request,
  }) => {
    const { project } = await seed(request);
    await page.setViewportSize({ width: 390, height: 900 });
    await openRuns(page, project.slug);
    const flaggedCard = dataRows(page).filter({ has: tag(page) });
    await expect(flaggedCard).toHaveCount(1);
    const cell = flaggedCard.getByTestId('run-cell');
    const head = (await cell.boundingBox())!;
    const t = (await tag(cell).boundingBox())!;
    const link = (await cell.locator('a').boundingBox())!;
    console.log('QA3-30', JSON.stringify({ head, t, link, card: await flaggedCard.boundingBox() }));
    expect([round(t.width), round(t.height)]).toEqual([20, 20]);
    expect(t.x + t.width).toBeLessThanOrEqual(link.x);
    expect(await cell.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    // The same card without the tag (descriptor without the flag) has the same height.
    const hFlag = round((await flaggedCard.boundingBox())!.height);
    const runId = (await flaggedCard.getAttribute('data-run-id'))!;
    await page.route('**/api/dashboard/runs', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const row of body.rows ?? []) if (row.experiment) delete row.experiment.latency_sensitive;
      await route.fulfill({ response: res, json: body });
    });
    await page.reload();
    await expect(dataRows(page)).toHaveCount(3);
    await expect(tag(page.getByTestId('runs-table'))).toHaveCount(0);
    const same = page.locator(`[data-testid="runs-table"] li[data-run-id="${runId}"]`);
    const hPlain = round((await same.first().boundingBox())!.height);
    console.log('QA3-30 card heights', hFlag, hPlain, JSON.stringify(await same.getByTestId('run-cell').boundingBox()), await same.getByTestId('run-cell').evaluate((el) => el.parentElement?.outerHTML.slice(0, 300) + ' | ' + getComputedStyle(el.parentElement!).cssText.length));
    expect(hFlag).toBe(hPlain);
  });

  test('a run whose descriptor has no flag shows no tag and logs no error (QA3-31)', async ({ page, request }) => {
    const { project } = await seed(request);
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/dashboard/runs', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      for (const row of body.rows ?? []) if (row.experiment) delete row.experiment.latency_sensitive;
      await route.fulfill({ response: res, json: body });
    });
    await openRuns(page, project.slug);
    await expect(dataRows(page)).toHaveCount(3);
    await expect(tag(page.getByTestId('runs-table'))).toHaveCount(0);
    expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
  });

  test('the API carries experiment.latency_sensitive on every official run, null for local (QA3-1)', async ({ request }) => {
    const { project } = await seed(request);
    const res = await request.post('/api/dashboard/runs', { data: { project_slug: project.slug, filters: {}, limit: 50, offset: 0 } });
    const rows = ((await res.json()) as { rows: { run_name: string; origin: string; experiment: { latency_sensitive: boolean } | null }[] }).rows;
    const official = rows.filter((r) => r.origin === 'official');
    expect(official.map((r) => r.experiment?.latency_sensitive).sort()).toEqual([false, true]);
    expect(rows.find((r) => r.origin === 'local')?.experiment).toBeNull();
  });
});

test.describe('other surfaces keep their markup (QA3-32)', () => {
  test('the Runs page has no latency filter, column or sort', async ({ page, request }) => {
    const { project } = await seed(request);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openRuns(page, project.slug);
    await expect(page.getByRole('columnheader', { name: /latency-sensitive/i })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /latency-sensitive/i })).toHaveCount(0);
  });
});
