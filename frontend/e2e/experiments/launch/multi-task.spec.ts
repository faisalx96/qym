/**
 * Round 9, point 2 (decision I1): one task per experiment. The Task section above Environments and Datasets (C-2-*):
 * one select, the union of the ticked environments' tasks, an availability row, the flagged environment, the launch
 * block, the stored spec (a string) and the read-only per-environment clone.
 */
import { expect, type Page } from '@playwright/test';
import { archiveProject, unarchiveProject } from '../../helpers';
import { expectNoPageOverflow, FAKE_A, resetFakes, setFakeTasks, test } from '../support';
import { captureExperimentPosts, openHome, openLaunch } from './launchSupport';
import { WIDTHS } from './multiSupport';
import {
  ANSWER,
  bar,
  box,
  cloneUrl,
  envBox,
  near,
  part,
  seedR9,
  taskSection,
  taskSelect,
  type R9Fixture,
} from './r9Support';

test.setTimeout(180_000);
test.use({ actionTimeout: 10_000 });

let f: R9Fixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedR9(request);
});

const both = () => `?env=${f.production.id},${f.staging.id}`;
const tick = (page: Page, name: string) => page.getByRole('checkbox', { name }).click({ force: true });

function countTasks(page: Page) {
  let hits: string[] = [];
  page.on('request', (r) => {
    const m = /\/eval-environments\/([^/]+)\/tasks$/.exec(r.url());
    if (r.method() === 'GET' && m) hits.push(m[1]!);
  });
  return { of: (id: string) => hits.filter((h) => h === id).length, total: () => hits.length, reset: () => (hits = []) };
}

test.describe('the Task section', () => {
  for (const width of WIDTHS) {
    test(`C-2-2 / C-2-3 geometry at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openHome(page, f.project.slug, both());
      await expect(taskSelect(page)).toBeEnabled();
      const section = await box(taskSection(page));
      const select = await box(part(page, 'task-select'));
      // The criterion measures the card's content (spec section 3, mock 73.6 / 148).
      if (width === 390) near(section.height, 148, 12, 'task-section height');
      else if (width === 1440) near(section.height, 74, 4, 'task-section height');
      else expect(section.height).toBeLessThanOrEqual(92); // 1024: the help line wraps to a second line (+15)
      near((await box(taskSelect(page))).height, 24, 0, 'select height');
      if (width === 390) near(select.width, section.width, 1, 'select fills the card content');
      else near(select.width, 360, 1, 'select width');
      // Directly above the Environments / Datasets row, one 14 px gap like the other cards.
      const card = await box(page.locator('section[aria-label="Task"]'));
      const next = await box(part(page, 'env-section'));
      near(next.y - (card.y + card.height), 14, 1, 'gap to env-section');
      await expectNoPageOverflow(page);
    });
  }

  test('C-2-1 no environment box holds a select or a Task control, and there is exactly one Task select', async ({ page }) => {
    await openHome(page, f.project.slug, both());
    await expect(taskSelect(page)).toBeEnabled();
    for (const name of ['production', 'staging']) {
      await expect(envBox(page, name).getByRole('button')).toHaveCount(1); // only Refresh
      await expect(envBox(page, name).locator('[data-env-task], select, [role=combobox]')).toHaveCount(0);
    }
    await expect(part(page, 'task-select')).toHaveCount(1);
  });

  test('C-2-4 the list is the union by id, Worker default first, with who offers each; one request per environment', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const counts = countTasks(page);
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(taskSelect(page)).toBeEnabled();
    await taskSelect(page).click();
    let texts = await page.getByRole('option').allInnerTexts();
    expect(texts.map((t) => t.split('\n')[0])).toEqual(['Worker default', 'Answer a ticket', 'Route a ticket', 'Summarise a ticket']);
    expect(texts[1]).toContain('production');
    expect(texts[1]).not.toContain('only'); // the only ticked environment offers it
    await page.keyboard.press('Escape');
    expect(counts.of(f.production.id)).toBe(1);
    await tick(page, 'staging');
    await expect(part(page, 'task-availability')).toBeVisible();
    await taskSelect(page).click();
    texts = await page.getByRole('option').allInnerTexts();
    expect(texts.map((t) => t.split('\n')[0])).toEqual(['Worker default', 'Answer a ticket', 'Route a ticket', 'Summarise a ticket']);
    expect(texts[1]).toContain('production and staging');
    expect(texts[2]).toContain('production only');
    await page.keyboard.press('Escape');
    // Ticking staging read staging once and did not read production again.
    expect(counts.of(f.production.id)).toBe(1);
    expect(counts.of(f.staging.id)).toBe(1);
  });

  test('C-2-5 with nothing ticked the select is disabled and the section keeps its height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug);
    await expect(taskSection(page)).toContainText('Pick an environment first');
    await expect(taskSelect(page)).toBeDisabled();
    const empty = await box(taskSection(page));
    await tick(page, 'production');
    await expect(taskSelect(page)).toBeEnabled();
    near((await box(taskSection(page))).height, empty.height, 0.5, 'height with an environment ticked');
  });

  test('C-2-6 a task an environment does not offer flags it, blocks Launch, and fixing it clears all four', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug, both());
    await expect(taskSelect(page)).toBeEnabled();
    await taskSelect(page).click();
    await page.getByRole('option', { name: /Route a ticket/ }).click();
    // staging does not list route-ticket
    await expect(envBox(page, 'staging')).toHaveAttribute('data-state', 'flagged');
    await expect(envBox(page, 'production')).toHaveAttribute('data-state', 'selected');
    await expect(envBox(page, 'staging').locator('[data-part=env-flag]')).toContainText('does not offer the task');
    await expect(part(page, 'task-availability').locator('[data-offered=false]')).toContainText('staging: not offered');
    await expect(part(page, 'bar-launch')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeDisabled();
    // the review names the environment and the task, and focus goes to the select
    await page.getByRole('button', { name: 'Customize →' }).click();
    await page.getByRole('button', { name: /Review and launch/ }).first().click();
    const problem = page.getByRole('list', { name: 'Problems to fix' }).getByRole('button', { name: /staging does not offer the task “route-ticket”/ });
    await expect(problem).toBeVisible();
    await problem.click();
    await expect(page.getByRole('heading', { name: 'Where it runs', level: 2 })).toBeVisible();
    await expect(taskSelect(page)).toBeFocused();
    // untick the environment: all four go away
    await tick(page, 'staging');
    await expect(envBox(page, 'staging')).toHaveCount(1);
    await expect(page.locator('[data-part=env-box][data-state=flagged]')).toHaveCount(0, { timeout: 1000 });
    await expect(part(page, 'task-availability').locator('[data-offered=false]')).toHaveCount(0);
    await expect(part(page, 'bar-status')).not.toContainText('does not offer');
  });

  test('C-2-7 the section is not rendered when no active environment declares task', async ({ page, request }) => {
    await resetFakes(request);
    f = await seedR9(request, { tasks: false });
    await openHome(page, f.project.slug, both());
    await expect(page.getByRole('checkbox', { name: 'production' })).toBeChecked();
    await expect(taskSection(page)).toHaveCount(0);
    await expect(page.locator('section[aria-label="Task"]')).toHaveCount(0);
  });

  test('C-2-8 the launch body carries one task string; the environments derive it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts = captureExperimentPosts(page);
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(taskSelect(page)).toBeEnabled();
    await taskSelect(page).click();
    await page.getByRole('option', { name: /Route a ticket/ }).click();
    await expect.poll(() => posts.dryRuns.at(-1)?.body.spec.evaluator.task).toBe('route-ticket');
    // choosing Worker default leaves it out
    await taskSelect(page).click();
    await page.getByRole('option', { name: 'Worker default' }).click();
    await expect.poll(() => posts.dryRuns.at(-1)?.body.spec.evaluator.task).toBeUndefined();
  });

  test('C-2-8 a clone of a per-environment experiment shows "Different per environment", read only, and sends the object', async ({ page, request }) => {
    const { launchExperiment } = await import('../support');
    const x = await launchExperiment(request, f.project.id, {
      name: 'old per-environment tasks',
      environment_ids: [f.production.id, f.staging.id],
      spec: {
        evaluator: { dataset: 'support-tickets', task: { [f.production.id]: 'route-ticket', [f.staging.id]: 'answer-ticket' }, config: { samples: 1 } },
        slot_bindings: { 'endpoint:primary': { connection_id: f.connectionId } },
        env_overrides: {},
      },
    });
    const posts = captureExperimentPosts(page);
    await page.goto(cloneUrl(f.project.slug, x.id));
    await expect(taskSection(page)).toContainText('Different per environment');
    await expect(taskSelect(page)).toBeDisabled();
    await expect.poll(() => posts.dryRuns.at(-1)?.body.spec.evaluator.task).toEqual({
      [f.production.id]: 'route-ticket',
      [f.staging.id]: 'answer-ticket',
    });
  });

  test('the loading frame has the loaded height', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setFakeTasks(request, FAKE_A, { tasks: [ANSWER], delay_ms: 1500 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(part(page, 'task-availability')).toContainText('Reading tasks');
    const loading = await box(taskSection(page));
    await expect(taskSelect(page)).toBeEnabled({ timeout: 8000 });
    near((await box(taskSection(page))).height, loading.height, 1, 'height loading vs loaded');
  });

  test('an unreadable list says why and does not block; an unsupported one offers only Worker default', async ({ page, request }) => {
    await setFakeTasks(request, FAKE_A, { status: 503 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(taskSection(page)).toContainText('Couldn’t read the tasks of production');
    await setFakeTasks(request, FAKE_A, { status: 404 });
    await page.reload();
    await expect(taskSelect(page)).toBeEnabled();
    await taskSelect(page).click();
    await expect(page.getByRole('option')).toHaveCount(1);
  });

  test('an archived project shows the task but cannot change it', async ({ page, request }) => {
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(taskSelect(page)).toBeEnabled();
    await archiveProject(request, f.project.id);
    try {
      await page.reload();
      await expect(taskSelect(page)).toBeDisabled();
    } finally {
      await unarchiveProject(request, f.project.id);
    }
  });

  test('Customize step 1 shows the same section under the name and priority', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLaunch(page, f.project.slug, both());
    await expect(taskSelect(page)).toBeEnabled();
    const name = await box(page.getByRole('region', { name: 'Name and priority' }));
    const task = await box(page.locator('section[aria-label="Task"]'));
    expect(task.y).toBeGreaterThan(name.y + name.height);
    await expect(bar(page)).toBeVisible();
  });
});
