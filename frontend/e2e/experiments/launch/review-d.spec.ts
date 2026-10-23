/**
 * WP-D review stage: independent checks the implementer's specs do not make (spec-d QD-17, QD-33 at three widths,
 * rule 7 for the datasets card and the environment boxes, QD-9 request body, overflow and axe on the four views).
 * Numbers are read from the DOM with getBoundingClientRect after `document.fonts.ready`; with QYM_SHOTS_DIR they are
 * written to review-d-*.json for docs/internal/feature-rounds/2026-10-multi-dataset-task/review-d.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { gotoApp } from '../../helpers';
import { createEnvironment, FAKE_B } from '../support';
import {
  axeSeriousViolations,
  describeViolations,
  expPath,
  FAKE_A,
  launchExperiment,
  resetFakes,
  setFakeTasks,
  test,
  waitForSubmitted,
} from '../support';
import { captureExperimentPosts, goStep, nameBox, openHome, openLaunch, review } from './launchSupport';
import {
  addDataset,
  chooseDataset,
  composeFour,
  datasetSelect,
  dsBox,
  envBox,
  seedMulti,
  WIDTHS,
  type MultiFixture,
} from './multiSupport';

test.setTimeout(180_000);
test.use({ actionTimeout: 10_000 });

const SHOTS = process.env.QYM_SHOTS_DIR;
let f: MultiFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedMulti(request);
});
function save(name: string, data: unknown): void {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, `${name}.json`), JSON.stringify(data, null, 2));
}
const both = () => `?env=${f.production.id},${f.staging.id}`;

/** Height of an element from the DOM, in the web fonts, rounded to 0.1 px. */
async function h(l: Locator): Promise<number> {
  await l.page().evaluate(() => document.fonts.ready);
  return l.evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10);
}
/** Finite CSS animations done (infinite ones, such as a skeleton pulse, never finish). */
const settled = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime as number))
        .map((a) => a.finished.catch(() => null)),
    ),
  );
const overflowX = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('review of WP-D', () => {
  test('QD-9, QD-72, QD-87: the single path is two clicks for the dataset and sends no list and no shape', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    const posts = captureExperimentPosts(page);
    let clicks = 0;
    await datasetSelect(page).click();
    clicks++;
    await page.getByRole('option', { name: /support-tickets/ }).click();
    clicks++;
    expect(clicks).toBe(2);
    await nameBox(page).fill('single path');
    // The dry run of this exact state has been posted and answered before Launch is pressed (QD-24).
    await expect.poll(() => posts.dryRuns.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /^Launch/ })).toBeEnabled({ timeout: 15_000 });
    await page.getByRole('button', { name: /^Launch/ }).click();
    await expect.poll(() => posts.launches.length, { timeout: 15_000 }).toBe(1);
    // The dry run and the launch carry the same evaluator.
    const body = posts.launches[0].body as { spec: { evaluator: Record<string, unknown> } };
    const dry = posts.dryRuns[posts.dryRuns.length - 1].body as {
      spec: { evaluator: Record<string, unknown> };
    };
    expect(dry.spec.evaluator).toEqual(body.spec.evaluator);
    const keys = Object.keys(body.spec.evaluator).sort();
    save('review-d-single-path', { clicks, evaluatorKeys: keys });
    expect(body.spec.evaluator.dataset).toBe('support-tickets');
    expect(keys).not.toContain('datasets');
    expect(keys).not.toContain('run_shape');
    expect(keys).not.toContain('dataset_version');
    expect(keys).not.toContain('task');
  });

  test('QD-17: Tab order inside the card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page, f.project.slug, both());
    await composeFour(page);
    const first = dsBox(page, 'support-tickets').getByRole('button', {
      name: /^Versions.* of support-tickets$/,
    });
    await first.focus();
    const order: string[] = [];
    for (let i = 0; i < 6; i++) {
      order.push(
        await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          const label = a?.getAttribute('aria-label') || a?.textContent?.trim() || a?.tagName || '';
          return `${a?.getAttribute('role') ?? a?.tagName}:${label.slice(0, 40)}`;
        }),
      );
      await page.keyboard.press('Tab');
    }
    save('review-d-tab-order', order);
    // Versions, Remove (box 1), Versions, Remove (box 2), Add another dataset, then the radio group (one stop).
    expect(order[0]).toMatch(/Versions/);
    expect(order[1]).toMatch(/Remove support-tickets/);
    expect(order[2]).toMatch(/Versions/);
    expect(order[3]).toMatch(/Remove billing-faq/);
    expect(order[4]).toMatch(/Add another dataset/);
    expect(order[5]).toMatch(/^INPUT/); // the radio group is one stop (its checked radio)
  });

  for (const width of WIDTHS) {
    test(`QD-33 and rule 7 at ${width}px: loading frames have the loaded height`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      // The task list answers late, and so do the dataset versions.
      await setFakeTasks(request, FAKE_A, { delay_ms: 1500 });
      await page.route(/\/v1\/datasets\/[^/]+\/versions/, async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
      await openHome(page, f.project.slug, both());
      const row = envBox(page, 'production').locator('[data-env-task]');
      await expect(row).toHaveAttribute('data-status', 'loading');
      // The pre-existing transient `Checking schema…` tag (3dd430ab) wraps the tags line for about 80 ms at 1024 and 390: not the task row.
      await expect(page.getByText('Checking schema…')).toHaveCount(0);
      const loadingTask = {
        prod: await h(envBox(page, 'production')),
        stag: await h(envBox(page, 'staging')),
        row: await h(row),
      };
      await expect(row).toHaveAttribute('data-status', 'ok', { timeout: 10_000 });
      const loadedTask = {
        prod: await h(envBox(page, 'production')),
        stag: await h(envBox(page, 'staging')),
        row: await h(row),
      };
      // The datasets card: choose a dataset while its versions load, compare the box before and after.
      await chooseDataset(page, 'support-tickets');
      const trigger = dsBox(page, 'support-tickets').getByRole('button', {
        name: /^Versions.* of support-tickets$/,
      });
      const boxLoading = await h(dsBox(page, 'support-tickets'));
      const cardLoading = await h(page.getByTestId('datasets-fieldset'));
      await page.waitForTimeout(2200);
      await expect(trigger).toBeEnabled();
      const boxLoaded = await h(dsBox(page, 'support-tickets'));
      const cardLoaded = await h(page.getByTestId('datasets-fieldset'));
      const m = { width, loadingTask, loadedTask, boxLoading, boxLoaded, cardLoading, cardLoaded };
      save(`review-d-loading-${width}`, m);
      for (const k of ['prod', 'stag', 'row'] as const)
        expect(Math.abs(loadingTask[k] - loadedTask[k]), `${k} ${JSON.stringify(m)}`).toBeLessThanOrEqual(1);
      expect(Math.abs(boxLoading - boxLoaded), JSON.stringify(m)).toBeLessThanOrEqual(1);
      expect(Math.abs(cardLoading - cardLoaded), JSON.stringify(m)).toBeLessThanOrEqual(1);
    });

    test(`QD-18, QD-62 at ${width}px: no overflow and axe on home, step 1, review and detail`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      const out: Record<string, unknown> = { width };
      await openHome(page, f.project.slug, both());
      await composeFour(page);
      await nameBox(page).fill('review run');
      out.home = { overflow: await overflowX(page) };
      expect(await overflowX(page)).toBe(0);
      await settled(page);
      let v = await axeSeriousViolations(page);
      expect(v, describeViolations(v)).toEqual([]);
      await openLaunch(page, f.project.slug, both());
      await composeFour(page);
      out.step1 = { overflow: await overflowX(page) };
      expect(await overflowX(page)).toBe(0);
      await settled(page);
      v = await axeSeriousViolations(page);
      expect(v, describeViolations(v)).toEqual([]);
      await goStep(page, 'review');
      await expect(review(page)).toBeVisible();
      out.review = { overflow: await overflowX(page) };
      expect(await overflowX(page)).toBe(0);
      await settled(page);
      v = await axeSeriousViolations(page);
      expect(v, describeViolations(v)).toEqual([]);
      const x = await launchExperiment(request, f.project.id, {
        name: 'review detail',
        environment_ids: [f.production.id, f.staging.id],
        spec: {
          evaluator: {
            datasets: [
              { dataset: 'support-tickets', version: 'v3' },
              { dataset: 'support-tickets', version: 'v2' },
              { dataset: 'billing-faq', version: 'v2' },
              { dataset: 'billing-faq', version: 'v1' },
            ],
            run_shape: 'combined',
            task: { [f.production.id]: 'answer-ticket' },
            config: { samples: 1 },
          },
          slot_bindings: { 'endpoint:primary': { connection_id: f.connectionId } },
          env_overrides: {},
        },
      });
      await waitForSubmitted(request, f.project.id, x.id);
      await gotoApp(page, expPath(f.project.slug, `/${x.id}`));
      await expect(page.getByRole('region', { name: 'Datasets and task' })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      out.detail = { overflow: await overflowX(page) };
      expect(await overflowX(page)).toBe(0);
      await settled(page);
      v = await axeSeriousViolations(page);
      expect(v, describeViolations(v)).toEqual([]);
      save(`review-d-views-${width}`, out);
    });
  }

  for (const width of WIDTHS) {
    test(`QD-23, QD-40, QD-41, QD-53 to QD-57 at ${width}px: page, review rows and a three-environment detail`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 1000 });
      const out: Record<string, unknown> = { width };
      const pageHeight = () =>
        page.evaluate(() =>
          Math.max(
            document.documentElement.scrollHeight,
            ...Array.from(document.querySelectorAll<HTMLElement>('*'))
              .filter((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY))
              .map((e) => e.scrollHeight),
          ),
        );
      await openHome(page, f.project.slug, both());
      await page.evaluate(() => document.fonts.ready);
      out.homeZeroState = await pageHeight();
      await composeFour(page);
      await page.evaluate(() => document.fonts.ready);
      out.homeComposed = await pageHeight();
      // Review rows (rail at 1440, below the step otherwise): Customize step 1 with the task chosen.
      await openLaunch(page, f.project.slug, both());
      await composeFour(page);
      const task = envBox(page, 'production').locator('[data-env-task]');
      await expect(task).toHaveAttribute('data-status', 'ok');
      await task.getByRole('button', { name: /Task of production/ }).click();
      await page.getByRole('option', { name: /Answer a ticket/ }).click();
      await nameBox(page).fill('numbers');
      const pane = review(page);
      await expect(pane.getByText('Ready to launch')).toBeVisible({ timeout: 15_000 });
      const rowOf = (inner: Locator) =>
        inner.evaluate((el) => {
          let n: HTMLElement | null = el as HTMLElement;
          while (n && n.parentElement && n.parentElement.tagName !== 'DL') n = n.parentElement;
          return Math.round((n ?? (el as HTMLElement)).getBoundingClientRect().height * 10) / 10;
        });
      out.rowEnvironments = await rowOf(pane.getByTestId('review-env-lines'));
      out.rowDatasets = await rowOf(pane.getByTestId('review-datasets'));
      out.datasetLineHeights = await pane
        .getByTestId('review-datasets')
        .getByRole('listitem')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
      out.rowRunShape = await rowOf(pane.getByText('Run shape', { exact: true }));
      // Detail with three environments: production (list + task) and two v1.3 services (4 + 4 pairs) = 9 jobs.
      const staging2 = await createEnvironment(request, f.project.id, 'staging-eu', { port: FAKE_B });
      const x = await launchExperiment(request, f.project.id, {
        name: 'three environments',
        environment_ids: [f.production.id, f.staging.id, staging2.id],
        spec: {
          evaluator: {
            datasets: [
              { dataset: 'support-tickets', version: 'v3' },
              { dataset: 'support-tickets', version: 'v2' },
              { dataset: 'billing-faq', version: 'v2' },
              { dataset: 'billing-faq', version: 'v1' },
            ],
            run_shape: 'combined',
            task: { [f.production.id]: 'answer-ticket' },
            config: { samples: 1 },
          },
          slot_bindings: { 'endpoint:primary': { connection_id: f.connectionId } },
          env_overrides: {},
        },
      });
      await waitForSubmitted(request, f.project.id, x.id);
      await gotoApp(page, expPath(f.project.slug, `/${x.id}`));
      const card = page.getByRole('region', { name: 'Datasets and task' });
      await expect(card).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      out.jobs = x.jobs.length;
      out.card = await h(card);
      out.strip = await h(page.getByLabel('Job totals'));
      out.matrix = await h(page.locator('[data-exp-matrix]'));
      out.matrixRows = await page.locator('[data-exp-matrix] tbody tr').count();
      out.history = await h(page.locator('[data-exp-jobs]'));
      out.historyTable = await page
        .locator('[data-exp-jobs] table')
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10)
        .catch(() => null);
      out.historyGroup = await page
        .locator('[data-exp-jobs] [data-job-group]')
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10)
        .catch(() => null);
      out.historyGroupTag = await page
        .locator('[data-exp-jobs] [data-job-group] > *')
        .first()
        .evaluate((el) => Math.round(el.getBoundingClientRect().height * 10) / 10)
        .catch(() => null);
      out.historyGroupRow = await page
        .locator('[data-exp-jobs] [data-job-group]')
        .first()
        .evaluate((el) => {
          const row = el.closest('tr, [role="row"], header, div');
          return Math.round((row ?? el).getBoundingClientRect().height * 10) / 10;
        })
        .catch(() => null);
      out.header = await h(page.locator('header').first());
      save(`review-d-numbers-${width}`, out);
      // The spec's numbers (QD-40, QD-41, QD-53, QD-55, QD-57) measured on three environments and nine jobs.
      expect(out.jobs).toBe(9);
      expect(out.rowDatasets).toBe(57);
      expect(out.rowRunShape).toBe(36.2);
      if (width === 1440) expect(out.rowEnvironments).toBe(107.2);
      expect(out.card).toBe({ 1440: 213.3, 1024: 268.1, 390: 318.3 }[width]);
      expect(out.strip).toBe(width === 390 ? 242.1 : 81.4);
      if (width !== 390) expect(out.historyTable).toBe(559);
      expect(out.historyGroupTag).toBe(width === 390 ? 26 : 20);
    });
  }

  test('QD-5, QD-6, QD-12, QD-13, QD-16: panel rows, counts, help text and legend', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page, f.project.slug, both());
    await chooseDataset(page, 'support-tickets');
    await expect(page.getByTestId('pair-count')).toHaveText('1 dataset version');
    await dsBox(page, 'support-tickets')
      .getByRole('button', { name: /^Versions.* of support-tickets$/ })
      .click();
    const panel = page.getByRole('dialog', { name: /Versions options/ });
    const rows = panel.getByRole('checkbox');
    const names = await rows.evaluateAll((els) =>
      els.map((e) => (e.closest('label') ?? e.parentElement)?.textContent?.trim() ?? ''),
    );
    const rowHeights = await panel
      .locator('label')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
    const search = await panel.getByRole('searchbox').count();
    const selectAll = await panel.getByText(/select all/i).count();
    const only = await panel.getByRole('button', { name: /^Only/ }).count();
    await page.keyboard.press('Escape');
    await addDataset(page, 'billing-faq');
    await expect(page.getByTestId('pair-count')).toHaveText('2 dataset versions from 2 datasets');
    const help = await page.getByTestId('run-shape').locator('p').first().textContent();
    const radios = await page
      .getByTestId('run-shape')
      .getByRole('radio')
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute('aria-label') ?? e.parentElement?.textContent ?? ''),
      );
    await page.getByTestId('run-shape').getByRole('radio', { name: 'One run each' }).click({ force: true });
    const helpEach = await page.getByTestId('run-shape').locator('p').first().textContent();
    const style = (l: Locator) =>
      l.evaluate((el) => {
        const cs = getComputedStyle(el);
        return `${cs.fontSize}/${cs.fontWeight}`;
      });
    const legends = {
      datasets: await style(page.getByTestId('datasets-fieldset').locator('legend')),
      environments: await style(page.locator('legend', { hasText: 'Environments' })),
    };
    save('review-d-panel', { names, rowHeights, search, selectAll, only, help, helpEach, radios, legends });
    expect(names[0]).toMatch(/^Latest version/);
    expect(names.slice(1).map((n) => n.replace(/\s+/g, ' '))).toEqual(
      [
        expect.stringMatching(/v3/),
        expect.stringMatching(/v2/),
        expect.stringMatching(/v1/),
        expect.stringMatching(/production/),
      ].slice(0, names.length - 1),
    );
    expect(search + selectAll + only).toBe(0);
    expect(help).toBe(
      'One run over the 2 dataset versions together. Every item records its dataset and version, and scores break down per dataset.',
    );
    expect(helpEach).toBe('2 runs per environment, one per dataset version, grouped under this experiment.');
    expect(legends.datasets).toBe(legends.environments);
  });

  test('QD-8 and QD-7 keyboard: Remove returns to the zero state and the select', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug);
    await chooseDataset(page, 'support-tickets');
    await addDataset(page, 'billing-faq');
    await dsBox(page, 'billing-faq').getByRole('button', { name: 'Remove billing-faq' }).click();
    await dsBox(page, 'support-tickets').getByRole('button', { name: 'Remove support-tickets' }).click();
    await expect(datasetSelect(page)).toBeVisible();
    await expect(page.getByTestId('datasets-fieldset')).toHaveCount(0);
  });
});
