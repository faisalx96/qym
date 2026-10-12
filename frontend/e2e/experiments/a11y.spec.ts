/**
 * Accessibility + small-screen checks for every page of the area: axe-core (serious and
 * critical must be zero) with the page's dialogs open, keyboard-only operation of the main
 * controls, and no horizontal page overflow at 390px.
 */
import { expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  FAKE_A,
  FAKE_B,
  axeSeriousViolations,
  createApiKey,
  createEnvironment,
  describeViolations,
  expectNoPageOverflow,
  pageOverflow,
  experimentSpec,
  finishJob,
  ingestRun,
  launchExperiment,
  linkRunToJob,
  pauseEnvironment,
  publishDefaultPreset,
  resetFakes,
  test,
  saveSavedPreset,
  seedProject,
  waitForDashboardRuns,
  waitForSubmitted,
  withFakesLock,
  type ExperimentView,
  type Seeded,
  type SeededEnv,
} from './support';
import { tabTo } from './ui';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

interface World {
  seeded: Seeded;
  staging: SeededEnv;
  production: SeededEnv;
  sweep: ExperimentView;
  held: ExperimentView;
}
let world: World;

test.beforeAll(async ({ request }) => {
  test.setTimeout(180_000);
  // The seeding below resets and drives the shared fake services: hold the lock the tests take.
  await withFakesLock(async () => {
    await resetFakes(request);
    const seeded = await seedProject(request, 'a11y');
    const { project, connectionId } = seeded;
    const staging = await createEnvironment(request, project.id, 'staging');
    const production = await createEnvironment(request, project.id, 'production', { port: FAKE_B });
    await publishDefaultPreset(request, project.id, staging.id, experimentSpec(connectionId));
    await saveSavedPreset(request, project.id, staging.id, 'Fast timeouts', experimentSpec(connectionId, 15));
    const key = await createApiKey(request, project.id);
    const sweep = await launchExperiment(request, project.id, {
      name: 'timeout sweep',
      environment_ids: [staging.id],
      spec: experimentSpec(connectionId, { sweep: [10, 30, 60] }),
    });
    const live = await waitForSubmitted(request, project.id, sweep.id);
    const jobs = [...live.jobs].sort((a, b) => a.combo_index - b.combo_index);
    for (const [i, job] of jobs.slice(0, 2).entries()) {
      await linkRunToJob(request, key, job, sweep.id, `sweep-${i}`);
      await finishJob(request, project.id, sweep.id, job.id, 'SUCCEEDED');
    }
    await pauseEnvironment(request, project.id, production.id, FAKE_B);
    const held = await launchExperiment(request, project.id, {
      name: 'held on production',
      environment_ids: [production.id],
      spec: experimentSpec(connectionId),
    });
    await ingestRun(request, key, { name: 'model-a-1', model: 'model-a', scores: [1, 1] });
    await ingestRun(request, key, { name: 'model-a-2', model: 'model-a', scores: [1, 1] });
    await ingestRun(request, key, { name: 'model-b-1', model: 'model-b', scores: [0, 0] });
    await waitForDashboardRuns(request, project.slug, 5, 'qa');
    world = { seeded, staging, production, sweep, held };
  });
});

const pages = (w: World) => [
  {
    name: 'experiments list',
    path: `/projects/${w.seeded.project.slug}/experiments`,
    ready: '[data-experiments-list]',
  },
  {
    name: 'experiment detail',
    path: `/projects/${w.seeded.project.slug}/experiments/${w.sweep.id}`,
    ready: '[data-exp-matrix]',
  },
  {
    name: 'queued experiment detail',
    path: `/projects/${w.seeded.project.slug}/experiments/${w.held.id}`,
    ready: '[data-exp-matrix]',
  },
  { name: 'queue', path: `/projects/${w.seeded.project.slug}/experiments/queue`, ready: '[data-queue-page]' },
  {
    name: 'environments',
    path: `/projects/${w.seeded.project.slug}/environments`,
    ready: '[data-environments-page]',
  },
  {
    name: 'environment',
    path: `/projects/${w.seeded.project.slug}/environments/${w.staging.id}`,
    ready: '[data-environment-page]',
  },
  { name: 'models', path: `/projects/${w.seeded.project.slug}/models`, ready: '[data-models-page]' },
  {
    name: 'settings environments tab',
    path: `/projects/${w.seeded.project.slug}/settings?tab=environments`,
    ready: '[data-environments-panel]',
  },
];

async function open(page: Page, p: { path: string; ready: string }) {
  await gotoApp(page, p.path);
  await expect(page.locator(p.ready)).toBeVisible();
  // let tables and cards render before measuring
  await expect(page.getByRole('progressbar').or(page.locator('[aria-busy="true"]'))).toHaveCount(0, {
    timeout: 15_000,
  });
}

async function expectNoSeriousViolations(page: Page, label: string) {
  // Dialogs and drawers fade in: measuring contrast mid-fade reports washed-out colors.
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every((a) => a.playState === 'finished' || a.effect?.getComputedTiming().iterations === Infinity),
      null,
      { timeout: 4000 },
    )
    .catch(() => undefined);
  const v = await axeSeriousViolations(page);
  expect(v, `${label}\n${describeViolations(v)}`).toEqual([]);
}

test.describe('axe', () => {
  test('every page', async ({ page }) => {
    for (const p of pages(world)) {
      await open(page, p);
      if (p.name === 'models') await expect(page.locator('[data-model^="model-a|"]')).toBeVisible();
      if (p.name === 'environment')
        await expect(page.locator('[data-section="env-default-preset"]')).toBeVisible();
      await expectNoSeriousViolations(page, p.name);
    }
  });

  test('settings drawer and the models run-selection dialog', async ({ page }) => {
    const { project } = world.seeded;
    await gotoApp(page, `/projects/${project.slug}/settings?tab=environments&env=${world.staging.id}`);
    await expect(page.locator(`[data-env-body="${world.staging.id}"]`)).toBeVisible();
    await expectNoSeriousViolations(page, 'environment drawer');

    await gotoApp(page, `/projects/${project.slug}/models`);
    await page
      .locator('[data-model^="model-a|"]')
      .getByRole('button', { name: /Edit run selection/ })
      .click();
    await expect(page.getByRole('dialog', { name: /Select runs/ })).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('checkbox').first()).toBeVisible();
    await expectNoSeriousViolations(page, 'run selection dialog');
  });

  test('queue: split cancel dialog and remote section', async ({ page }) => {
    await open(page, pages(world)[3]!);
    await page.getByRole('button', { name: /Select all I can cancel/ }).click();
    await page.getByRole('button', { name: /^Cancel selected/ }).click();
    await expect(page.getByTestId('cancel-split-dialog')).toBeVisible();
    await expectNoSeriousViolations(page, 'cancel split dialog');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Remote queue/ }).click();
    await expect(page.getByRole('grid', { name: 'Remote jobs on staging' })).toBeVisible();
    await expectNoSeriousViolations(page, 'remote queue open');
  });

  test('detail: cancel confirm, save-as-preset form', async ({ page }) => {
    await open(page, pages(world)[2]!);
    await page.getByRole('button', { name: 'Cancel experiment' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expectNoSeriousViolations(page, 'cancel experiment confirm');
    await page.keyboard.press('Escape');
    await page.locator(`[data-exp-save-preset]`).first().click();
    await expect(page.getByRole('dialog', { name: 'Save as preset' })).toBeVisible();
    await expectNoSeriousViolations(page, 'save as preset');
  });

  test('environments: add dialog steps, slot editor, delete confirm', async ({ page }) => {
    const { project } = world.seeded;
    await gotoApp(page, `/projects/${project.slug}/environments`);
    await page.getByRole('button', { name: '+ Add environment' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Add environment' })).toBeVisible();
    await expectNoSeriousViolations(page, 'add environment: connect');
    await page.keyboard.press('Escape');

    await gotoApp(page, `/projects/${project.slug}/environments/${world.staging.id}`);
    await page.locator('[data-section="env-slots"]').getByRole('button', { name: 'Edit groups' }).click();
    await expect(
      page
        .getByRole('dialog', { name: /LLM model groups/ })
        .locator('[data-slot-key]')
        .first(),
    ).toBeVisible();
    await expectNoSeriousViolations(page, 'slot editor');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Delete environment' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expectNoSeriousViolations(page, 'delete environment confirm');
  });
});

test.describe('390px viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('no page-level horizontal scroll on any page', async ({ page }) => {
    const problems: string[] = [];
    for (const p of pages(world)) {
      await open(page, p);
      const message = await pageOverflow(page);
      if (message) problems.push(`${p.name}: ${message}`);
    }
    expect(problems, 'pages that scroll horizontally').toEqual([]);
    // dialogs fit as well
    await open(page, pages(world)[3]!);
    await page.getByRole('button', { name: /Select all I can cancel/ }).click();
    await page.getByRole('button', { name: /^Cancel selected/ }).click();
    const dialog = page.getByTestId('cancel-split-dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await expectNoPageOverflow(page);
  });
});

test.describe('keyboard', () => {
  test('experiments list: a row opens with Enter, tabs move between sections', async ({ page }) => {
    await open(page, pages(world)[0]!);
    const grid = page.getByRole('grid', { name: 'Experiments' });
    await expect(grid.getByRole('row')).toHaveCount(3);
    await page.getByRole('tab', { name: 'Experiments' }).focus();
    // tabs are routes: arrow keys activate the next one and the page changes
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/\/experiments\/queue$/);
    await expect(page.locator('[data-queue-page]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-experiments-list]')).toBeVisible();
    const row = grid.getByRole('row').filter({ hasText: 'timeout sweep' });
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/experiments/${world.sweep.id}$`));
  });

  test('detail: select two runs and compare without a mouse', async ({ page }) => {
    await open(page, pages(world)[1]!);
    const matrix = page.locator('[data-exp-matrix]');
    const boxes = matrix.getByRole('checkbox');
    await expect(boxes).toHaveCount(2);
    await tabTo(page, boxes.first());
    await page.keyboard.press('Space');
    await expect(boxes.first()).toBeChecked();
    await tabTo(page, boxes.nth(1));
    await page.keyboard.press('Space');
    const compare = matrix.getByRole('button', { name: /Compare selected \(2\)/ });
    await expect(compare).toBeEnabled();
    await tabTo(page, compare);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/compare\?runs=/);
  });

  test('detail: the cancel confirm opens on the safe choice and Escape leaves everything as it was', async ({
    page,
  }) => {
    await open(page, pages(world)[2]!);
    const trigger = page.getByRole('button', { name: 'Cancel experiment' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Keep running' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('environments: add dialog is fully operable by keyboard and traps focus', async ({ page }) => {
    await open(page, pages(world)[4]!);
    const add = page.getByRole('button', { name: '+ Add environment' }).first();
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Add environment' });
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(add).toBeFocused();
  });

  test('models: Edit opens the run selection and Escape closes it', async ({ page }) => {
    await open(page, pages(world)[6]!);
    const edit = page.locator('[data-model^="model-a|"]').getByRole('button', { name: /Edit run selection/ });
    await edit.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Select runs/ });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(edit).toBeFocused();
  });
});

void FAKE_A;
