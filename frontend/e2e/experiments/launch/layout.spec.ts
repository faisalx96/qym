/** Mobile layout (390px: no page overflow, sticky launch bar) and axe-core on the entry and every section. */
import { expect } from '@playwright/test';
import { axeSeriousViolations, describeViolations, expectNoPageOverflow, resetFakes, test } from '../support';
import {
  expectReady,
  maxAttempts,
  nameBox,
  openGroup,
  openLaunch,
  settled,
  openSection,
  pickRadio,
  seedLaunch,
  type LaunchFixture,
} from './launchSupport';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

test.describe('390px', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('no horizontal page overflow and the sticky bar keeps Launch reachable', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('mobile run');
    await expectReady(page);
    await expectNoPageOverflow(page);
    for (const s of ['Models', 'Environment configurations', 'Evaluation configurations', 'Raw JSON']) {
      await openSection(page, s);
      await expectNoPageOverflow(page);
      if (s === 'Environment configurations') {
        await openGroup(page, 'LLM routing');
        await expectNoPageOverflow(page);
      }
    }
    await openSection(page, 'Models'); // the sticky launch bar is hidden on the review step
    // Scroll to the very bottom: the sticky bar is still in the viewport with an enabled Launch.
    await page.mouse.move(200, 300);
    await page.mouse.wheel(0, 100000);
    await page.waitForTimeout(300);
    const bar = page.getByRole('button', { name: 'Launch', exact: true }).last();
    await expect(bar).toBeInViewport();
    await expect(bar).toBeEnabled();
    await page.mouse.wheel(0, -100000);
    await page.waitForTimeout(300);
    await expect(bar).toBeInViewport();
    await bar.click();
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/);
  });

  test('the bar names the first problem and jumps to it', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const problem = page.getByRole('button', { name: /^Fix 1 problem first: Name/ });
    await expect(problem).toBeVisible();
    await expect(problem).toBeInViewport();
    await problem.click();
    await expect(nameBox(page)).toBeFocused();
  });
});

test.describe('axe-core', () => {
  async function expectClean(page: Parameters<typeof axeSeriousViolations>[0], what: string) {
    await settled(page);
    const v = await axeSeriousViolations(page);
    expect(v, `${what}\n${describeViolations(v)}`).toEqual([]);
  }

  test('entry screen and every open section', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('a11y run');
    await expectReady(page);
    await expectClean(page, 'entry');
    await openSection(page, 'Models');
    await expectClean(page, 'models');
    await pickRadio(page.getByRole('article', { name: 'Primary model' }), 'Temporary');
    await expectClean(page, 'models: temporary form open');
    await openSection(page, 'Environment configurations');
    await openGroup(page, 'LLM routing');
    await expectClean(page, 'environment configurations');
    await openSection(page, 'Evaluation configurations');
    await expectClean(page, 'evaluation');
    await openSection(page, 'Raw JSON');
    await expectClean(page, 'raw json');
  });

  test('sweeps section and the problem states', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const field = await maxAttempts(page);
    await field.fill('1');
    await page.getByRole('button', { name: 'Sweep values: primary · Max Attempts' }).click();
    await expect(page.getByRole('region', { name: /^Sweeps/ })).toBeVisible();
    await expectClean(page, 'sweeps + problems');
  });
});
