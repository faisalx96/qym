/**
 * Experiment creation redesign: the home view and the six-step Customize wizard (rail, Back /
 * Continue / Skip, review placement, error routing across steps, narrow layout, motion, axe).
 */
import { expect, type Page } from '@playwright/test';
import { axeSeriousViolations, describeViolations, resetFakes, test } from '../support';
import {
  expectReady,
  goStep,
  settled,
  launchButton,
  maxAttempts,
  nameBox,
  openHome,
  openLaunch,
  rail,
  review,
  seedLaunch,
  STEP_LABELS,
  type LaunchFixture,
  type StepId,
} from './launchSupport';

test.setTimeout(90_000);
test.use({ actionTimeout: 10_000 });

let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const STEPS: StepId[] = ['where', 'start', 'models', 'settings', 'evaluation', 'review'];

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const scroller = document.querySelector('main') ?? doc;
    return Math.max(doc.scrollWidth - doc.clientWidth, scroller.scrollWidth - scroller.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('wizard', () => {
  test('walks the six steps with Back, Continue and Skip, then launches from the review step', async ({
    page,
  }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('wizard run');
    await page.getByRole('button', { name: /Customize/ }).click();
    await expect(rail(page).locator('[aria-current="step"]')).toContainText('Where it runs');
    await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Skip to review' })).toHaveCount(0);
    await expect(review(page)).toBeVisible();

    const labels = STEPS.map((s) => STEP_LABELS[s]);
    for (let i = 1; i < 5; i++) {
      await page.getByRole('button', { name: `Continue to ${labels[i]!.toLowerCase()}` }).click();
      await expect(page.getByRole('heading', { name: labels[i]!, level: 2 })).toBeFocused();
      await expect(page).toHaveURL(new RegExp(`step=${STEPS[i]}`));
      const optional = i >= 2;
      await expect(page.getByRole('button', { name: 'Skip to review' })).toHaveCount(optional ? 1 : 0);
      await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(1);
    }
    await page.getByRole('button', { name: 'Skip to review' }).click();
    await expect(page.getByRole('heading', { name: 'Review and launch', level: 2 })).toBeVisible();
    // On the last step the review fills the main column (one pane) and Raw JSON sits under it.
    await expect(review(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Continue to/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /^Raw JSON/ })).toBeVisible();
    await expectReady(page);
    await launchButton(page).click();
    await expect(page).toHaveURL(/\/experiments\/[0-9a-f-]{36}$/);
  });

  test('the rail is never gated, shows changed counts and problem counts', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'review');
    await expect(rail(page).getByRole('button', { name: /Where it runs/ })).toContainText('1 to fix');
    await goStep(page, 'settings');
    const field = await maxAttempts(page);
    await field.fill('3');
    await expect(rail(page).getByRole('button', { name: /Environment configurations/ })).toContainText(
      '1 changed',
    );
    await goStep(page, 'where');
    await expect(rail(page).getByRole('button', { name: /Environment configurations/ })).toHaveAttribute(
      'data-state',
      'upcoming',
    );
  });

  test('an edit survives moving between steps and a problem click routes to its step', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('route run');
    await goStep(page, 'settings');
    const field = await maxAttempts(page);
    await field.fill('abc');
    await goStep(page, 'review');
    const problem = review(page)
      .getByRole('button', { name: /Max Attempts/ })
      .first();
    await problem.click();
    await expect(page).toHaveURL(/step=settings/);
    await expect(page.getByRole('textbox', { name: 'Max Attempts' })).toBeFocused();
    await expect(page.locator('[data-flash="true"]').first()).toBeAttached();
    await goStep(page, 'where');
    await expect(nameBox(page)).toHaveValue('route run');
  });

  test('"Start" goes home, the "Edit" link of the review jumps to its step', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('edit run');
    await goStep(page, 'settings');
    await (await maxAttempts(page)).fill('3');
    await goStep(page, 'review');
    await review(page)
      .getByRole('button', { name: /Edit: Environment configurations/ })
      .click();
    await expect(page).toHaveURL(/step=settings/);
    await page.getByRole('button', { name: '← Start' }).click();
    await expect(page).not.toHaveURL(/step=/);
    await expect(nameBox(page)).toHaveValue('edit run');
  });

  test('Reload on a ?step= link opens that step; a step without an environment shows a hint', async ({
    page,
  }) => {
    await openLaunch(page, f.project.slug, '', 'models');
    await expect(page.getByText('Pick an environment first (step 1)')).toBeVisible();
    await page.goto(`/projects/${f.project.slug}/experiments/new?step=bogus`);
    await expect(page.getByRole('heading', { name: 'Where it runs', level: 2 })).toBeVisible();
  });
});

test.describe('layout', () => {
  for (const width of [390, 768, 1280]) {
    test(`${width}px: home and every step fit the width and pass axe`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page, f.project.slug, `?env=${f.env.id}`);
      await nameBox(page).fill('layout run');
      await expectNoOverflow(page);
      await expect(page.getByRole('button', { name: /Customize/ })).toBeInViewport();
      await settled(page);
      let v = await axeSeriousViolations(page);
      expect(v, `home\n${describeViolations(v)}`).toEqual([]);
      await page.getByRole('button', { name: /Customize/ }).click();
      for (const step of STEPS) {
        if (width < 760) await expect(page.getByText(/^Step \d of 6:/).first()).toBeVisible();
        await goStep(page, step);
        await settled(page);
        await expectNoOverflow(page);
        v = await axeSeriousViolations(page);
        expect(v, `${step}\n${describeViolations(v)}`).toEqual([]);
      }
    });
  }

  test('1920px: the rail is six across and the aside stays beside the step', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const tops = await rail(page)
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const aside = await review(page).boundingBox();
    const panel = await page.getByRole('heading', { name: 'Where it runs', level: 2 }).boundingBox();
    expect(aside!.x).toBeGreaterThan(panel!.x);
  });

  test('390px: the sticky Continue sits above the launch bar and the bar is gone on the review step', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'models');
    const bar = page.getByRole('region', { name: 'Launch', exact: true });
    await expect(bar).toBeVisible();
    const next = page.getByRole('button', { name: /Continue to environment configurations/ });
    await expect(next).toBeInViewport();
    const [nb, bb] = [await next.boundingBox(), await bar.boundingBox()];
    expect(nb!.y + nb!.height).toBeLessThanOrEqual(bb!.y + 1);
    await goStep(page, 'review');
    await expect(page.getByRole('region', { name: 'Launch', exact: true })).toHaveCount(0);
  });
});

test.describe('motion', () => {
  test('the step panel enters with the 180ms animation; reduced motion turns it off', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const panel = () => page.locator('[data-step]');
    await goStep(page, 'models');
    expect(await panel().evaluate((e) => getComputedStyle(e).animationName)).toContain('stepIn');
    expect(await panel().evaluate((e) => getComputedStyle(e).animationDuration)).toBe('0.18s');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goStep(page, 'settings');
    expect(await panel().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  });

  test('a settings group opens through the Collapse and closed content is not tabbable', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'settings');
    const toggle = page.getByRole('heading', { name: 'LLM routing', level: 4 }).getByRole('button');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('textbox', { name: 'Max Attempts' })).toBeVisible();
    await toggle.click();
    await expect(page.getByRole('textbox', { name: 'Max Attempts' })).toHaveCount(0);
  });
});

test.describe('polish', () => {
  test('a deep link to a settings step shows a skeleton, never a heading alone', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'models');
    const panel = page.locator('[data-step]');
    // Once the heading is there, the panel is never only the heading.
    const heights = await panel.evaluate(
      (el) =>
        new Promise<number[]>((resolve) => {
          const out: number[] = [];
          let n = 0;
          const tick = () => {
            out.push(Math.round(el.getBoundingClientRect().height));
            if (++n < 20) requestAnimationFrame(tick);
            else resolve(out);
          };
          tick();
        }),
    );
    expect(Math.min(...heights)).toBeGreaterThan(60);
  });

  test('Continue to a shorter step keeps the rail in place (scroll never clamps to 0)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 700 });
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'settings');
    await expect(page.getByRole('heading', { name: 'LLM routing', level: 4 })).toBeVisible();
    await page.getByRole('heading', { name: 'LLM routing', level: 4 }).getByRole('button').click();
    await page.getByRole('button', { name: /Continue to evaluation/ }).scrollIntoViewIfNeeded();
    const scroller = await page.evaluateHandle(() => document.querySelector('main')!);
    const before = await scroller.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(100);
    await scroller.evaluate((el) => {
      (window as unknown as { __tops: number[] }).__tops = [];
      const sample = () => {
        (window as unknown as { __tops: number[] }).__tops.push(el.scrollTop);
        requestAnimationFrame(sample);
      };
      sample();
    });
    await page.getByRole('button', { name: /Continue to evaluation/ }).click();
    await expect(page.getByRole('heading', { name: 'Evaluation configurations', level: 2 })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const t = (window as unknown as { __tops: number[] }).__tops;
          return t.length > 20 && t.slice(-15).every((v) => v === t[t.length - 1]);
        }),
      )
      .toBe(true);
    const tops = await page.evaluate(() => (window as unknown as { __tops: number[] }).__tops);
    const lowest = Math.min(...tops.slice(1));
    // It scrolls up towards the rail without first collapsing to the very top of the page.
    expect(lowest).toBeGreaterThan(0);
  });

  test('390px: step navigation is one row and the launch bar is one compact row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`, 'models');
    const nav = page.getByRole('navigation', { name: 'Step navigation' });
    const bar = page.getByRole('region', { name: 'Launch', exact: true });
    const [nb, bb] = [await nav.boundingBox(), await bar.boundingBox()];
    expect(nb!.height).toBeLessThan(50);
    expect(bb!.height).toBeLessThan(70);
    await expect(nav.getByRole('button', { name: 'Continue to environment configurations' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Skip to review' })).toBeVisible();
  });

  test('home: Launch as is is the accent action; saved presets and "Other" are separate rows', async ({
    page,
  }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(page.getByRole('button', { name: 'Launch as is' })).toHaveAttribute(
      'data-variant',
      'accent',
    );
    await expect(page.getByRole('button', { name: /Customize/ })).toHaveAttribute('data-variant', 'neutral');
    await expect(page.getByText('Saved presets', { exact: true })).toBeVisible();
    await expect(page.getByText('Other', { exact: true })).toBeVisible();
  });

  test('390px home: no header gap and the bar leaves room for the first start card', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(page.getByRole('link', { name: 'All experiments' })).toHaveCount(0);
    const bar = await page.getByRole('region', { name: 'Launch', exact: true }).boundingBox();
    expect(bar!.height).toBeLessThan(150);
  });
});
