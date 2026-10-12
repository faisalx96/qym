/** axe-core: zero serious / critical violations on the runs-list surfaces. */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { APP } from '../helpers';
import { BOOL, LOWER, SCORE, seedRun } from './seed';
import {
  axeSeriousViolations,
  clickBox,
  dataRows,
  describeViolations,
  freshProject,
  openFacet,
  openRuns,
  rowOf,
} from './support';

const NAME = 'summarize-repeat-done';
let slug = '';

async function ensureProject(request: APIRequestContext) {
  if (slug) return slug;
  const s = await freshProject(request, 12);
  await seedRun(request, s.token, {
    name: NAME,
    task: 'summarize',
    dataset: 'cnn-sample',
    model: 'openai/gpt-4o',
    metrics: { accuracy: BOOL, quality: SCORE, latency_s: LOWER },
    items: Array.from({ length: 6 }, (_, j) => ({ accuracy: j % 2, quality: 0.5 + j / 20, latency_s: 0.5 })),
    samples: 3,
    status: 'COMPLETED',
    gitBranch: 'main',
    gitCommit: 'abc1234',
  });
  await (await import('./seed')).waitForProjection(request, s.project.slug, s.runs.length + 1);
  slug = s.project.slug;
  return slug;
}

async function expectClean(page: Page, label: string) {
  // let entry / exit animations (dialog fade) finish: axe samples blended colours mid-animation
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
  const v = await axeSeriousViolations(page);
  expect(v, `${label}\n${describeViolations(v)}`).toEqual([]);
}

test.describe('axe on the runs-list surfaces', () => {
  test('Runs: default view', async ({ page, request }) => {
    await openRuns(page, await ensureProject(request));
    await expectClean(page, 'runs default');
  });

  test('Runs: Filters popover open with a facet disclosure open', async ({ page, request }) => {
    await openRuns(page, await ensureProject(request));
    await openFacet(page, 'Models');
    await expectClean(page, 'filters popover + Models facet');
  });

  test('Runs: select mode with a row ticked', async ({ page, request }) => {
    await openRuns(page, await ensureProject(request));
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await clickBox(dataRows(page).first().getByRole('checkbox'));
    await expect(page.getByTestId('selection-bar')).toContainText('1 execution selected');
    await expectClean(page, 'select mode');
  });

  test('Runs: expanded passes panel (select mode on)', async ({ page, request }) => {
    await openRuns(page, await ensureProject(request));
    await page.getByRole('button', { name: 'Select', exact: true }).click();
    await rowOf(page, NAME)
      .getByRole('button', { name: /Expand 3 passes/ })
      .click();
    await expect(page.getByRole('region', { name: `Passes of ${NAME}` }).getByRole('table')).toBeVisible();
    await expectClean(page, 'expanded passes');
  });

  test('Runs: row More menu and a confirm dialog open', async ({ page, request }) => {
    await openRuns(page, await ensureProject(request));
    await rowOf(page, 'text2sql-gpt-4o-000')
      .getByRole('button', { name: /^More actions for / })
      .click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expectClean(page, 'more menu');
    await page.keyboard.press('Escape');
    await rowOf(page, 'text2sql-gpt-4o-000')
      .getByRole('button', { name: /^Delete / })
      .click();
    await expect(page.getByRole('alertdialog').or(page.getByRole('dialog'))).toBeVisible();
    await expectClean(page, 'delete dialog');
  });

  test('Charts: grouped rows with a group expanded', async ({ page, request }) => {
    await page.goto(`${APP}/projects/${await ensureProject(request)}/charts`);
    const card = page.getByTestId('chart-card-summarize');
    await expect(card.getByRole('table')).toBeVisible();
    await card
      .getByRole('radiogroup', { name: 'summarize rows' })
      .getByText('Grouped', { exact: true })
      .click();
    await card
      .getByRole('button', { name: /^Expand / })
      .first()
      .click();
    await expect(
      card
        .getByRole('table')
        .getByRole('button', { name: /^Collapse / })
        .first(),
    ).toBeVisible();
    await expectClean(page, 'charts grouped');
  });

  test('Charts: default', async ({ page, request }) => {
    await page.goto(`${APP}/projects/${await ensureProject(request)}/charts`);
    await expect(page.getByTestId('chart-card-text2sql').getByRole('table')).toBeVisible();
    await expectClean(page, 'charts default');
  });

  test('Overview', async ({ page, request }) => {
    await page.goto(`${APP}/projects/${await ensureProject(request)}/overview?range=90d`);
    await expect(page.getByTestId('trend-chart')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Project KPIs')).toBeVisible();
    await expectClean(page, 'overview');
  });
});
