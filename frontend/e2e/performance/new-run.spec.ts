import { test, expect, type Page } from '@playwright/test';
import { gotoApp, uniqueSlug } from '../helpers';
import { asMember, DATASET_NAME, pageApi, seedPerformance } from './support';

const steps = (page: Page) => page.locator('[data-performance-block="step-bar"]');

async function next(page: Page, to: string) {
  await steps(page)
    .getByRole('button', { name: `Continue to ${to}` })
    .click();
  await expect(page.getByRole('region', { name: to })).toBeVisible();
}

async function walkToReview(page: Page, target: RegExp, dataset: RegExp) {
  await page
    .getByRole('radiogroup', { name: 'Target' })
    .getByRole('radio', { name: target })
    .click({ force: true });
  await next(page, 'Test');
  const breakpoint = page
    .getByRole('radiogroup', { name: 'Test' })
    .getByRole('radio', { name: /Breakpoint/ });
  await breakpoint.click({ force: true });
  await expect(breakpoint).toBeChecked();
  await next(page, 'Load');
  await next(page, 'Questions');
  const choice = page.getByRole('radiogroup', { name: 'Dataset' }).getByRole('radio', { name: dataset });
  await choice.click({ force: true });
  await expect(choice).toBeChecked();
  await next(page, 'Review and start');
}

test('a Member walks the five steps and starts a Breakpoint on preprod; Start is off while a check fails', async ({
  page,
  request,
}) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-new'), { signIn: false });
  await asMember(page);
  await gotoApp(page, `/projects/${seed.projectSlug}/performance/new`);
  await expect(page.getByRole('heading', { name: 'New run', exact: true })).toBeVisible();

  await walkToReview(page, /QA - Preprod/, new RegExp(DATASET_NAME));
  const start = steps(page).getByRole('button', { name: 'Start run' });
  await expect(start).toBeDisabled();
  await expect(steps(page)).toContainText('Start is off until');
  await expect(page.locator('[data-performance-block="checks"]').first()).toContainText(/sign-in/i);

  // Back to the first step: the Member saves the sign-in of the preprod target.
  await page.getByRole('navigation', { name: 'New run steps' }).getByText('Target and sign-in').click();
  const signIn = page.locator('[data-performance-block="sign-in"]');
  await signIn.getByLabel('Refresh token').fill('qa-member-refresh-4455');
  await signIn.getByRole('button', { name: 'Save tokens' }).click();
  await expect(signIn.getByRole('button', { name: 'Replace tokens' })).toBeVisible();
  await page.getByRole('navigation', { name: 'New run steps' }).getByText('Review and start').click();
  await expect(start).toBeEnabled();

  await start.click();
  const confirm = page
    .getByRole('dialog', { name: 'Start this run?' })
    .or(page.getByRole('alertdialog', { name: 'Start this run?' }));
  await expect(confirm.getByRole('textbox')).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(new RegExp(`/performance/runs/[^/]+$`));
  const runId = page.url().split('/').pop()!;
  await expect(page.locator('[data-performance-block="content"]')).toHaveAttribute(
    'data-performance-state',
    'queued',
  );

  // The fake runner sees exactly what the person chose.
  const run = await seed.runner.waitForQueued(runId);
  expect(run.config.test_type).toBe('breakpoint');
  expect(run.config.target).toMatchObject({ id: seed.preprod.id, name: 'QA - Preprod' });
  expect(run.config.dataset).toMatchObject({ version_id: seed.dataset.versionId, item_count: 6 });
  expect(run.tokens?.find((token) => token.name === 'refresh_token')?.value).toBe('qa-member-refresh-4455');
});

test('a production target asks for its name typed before Start', async ({ page, request }) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-new-prod'), { production: true });
  await gotoApp(page, `/projects/${seed.projectSlug}/performance/new`);
  await walkToReview(page, /QA - Production/, new RegExp(DATASET_NAME));
  await steps(page).getByRole('button', { name: 'Start run' }).click();

  const confirm = page
    .getByRole('dialog', { name: 'Start this run on production?' })
    .or(page.getByRole('alertdialog', { name: 'Start this run on production?' }));
  const typed = confirm.getByRole('textbox', {
    name: /Type the name of the target, QA - Production, to start/,
  });
  const go = confirm.getByRole('button', { name: 'Start on production' });
  await expect(go).toBeDisabled();
  await typed.fill('qa - production');
  await expect(go).toBeDisabled();
  await typed.fill('QA - Production');
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page).toHaveURL(new RegExp(`/performance/runs/[^/]+$`));
  const runId = page.url().split('/').pop()!;
  const run = await seed.runner.waitForQueued(runId);
  expect(run.config.target).toMatchObject({ id: seed.production!.id, name: 'QA - Production' });
});

test('a question file in an unusual structure becomes a dataset and is chosen', async ({ page, request }) => {
  const seed = await seedPerformance(request, uniqueSlug('perf-new-upload'), { dataset: false });
  // Not a list of dataset items: one named list per kind, other field names, nested records and a
  // note the finder must leave out.
  const file = {
    _about: 'QA sample questions',
    simple: [
      { ref: 'u1', ask: { text: 'Which months are in the sample?' }, then: 'Which of them is first?' },
      { ref: 'u4', ask: { text: 'How many groups are there?' } },
    ],
    medium: [{ ref: 'u2', ask: { text: 'What is the average for each group?' } }],
    complex: [{ ref: 'u3', ask: { text: 'Explain how each group changed over the year.' } }],
  };
  await gotoApp(page, `/projects/${seed.projectSlug}/performance/new`);
  await page
    .getByRole('radiogroup', { name: 'Target' })
    .getByRole('radio', { name: /QA - Preprod/ })
    .click({ force: true });
  await next(page, 'Test');
  await next(page, 'Load');
  await next(page, 'Questions');
  await page.getByRole('button', { name: 'Upload a file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload questions' });
  await dialog.getByLabel('Question file').setInputFiles({
    name: 'qa-unusual-questions.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await expect(dialog.locator('[data-performance-block="upload-fields"]')).toBeVisible();
  // The person confirms which field is what: the question sits one level down, the follow-up under "then".
  for (const [role, field] of [
    ['question', /ask\.text/],
    ['follow_up', /^then/],
  ] as const) {
    await dialog.locator(`[data-performance-role="${role}"]`).getByRole('button').first().click();
    await page.getByRole('option', { name: field }).click();
  }
  await expect(dialog.locator('[aria-label="What the run will get"]')).toContainText('4');
  await dialog.getByRole('button', { name: 'Continue to Save' }).click();
  const name = dialog.getByRole('textbox', { name: 'Dataset name' });
  await name.fill('QA - Unusual questions');
  await expect(dialog).toContainText('2 simple, 1 medium, 1 complex');
  await dialog.getByRole('button', { name: 'Save and use for this run' }).click();
  await expect(dialog).toHaveCount(0);

  const chosen = page
    .getByRole('radiogroup', { name: 'Dataset' })
    .getByRole('radio', { name: /QA - Unusual questions/ });
  await expect(chosen).toBeChecked();
  const listed = (await (await request.get(pageApi(seed.projectSlug, '/datasets'))).json()) as {
    datasets: { name: string; item_count: number; tier_counts: Record<string, number>; follow_ups: number }[];
  };
  expect(listed.datasets.find((dataset) => dataset.name === 'QA - Unusual questions')).toMatchObject({
    item_count: 4,
    tier_counts: { simple: 2, medium: 1, complex: 1 },
    follow_ups: 1,
  });
});
