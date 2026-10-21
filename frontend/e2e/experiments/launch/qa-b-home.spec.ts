/**
 * QA-B point 3 on the launch pages (spec-b QA3-10 to QA3-24, QA2-9, QA2-10): the one latency control
 * (`doc.latencySensitive`) on the home view and on Customize step 1, the Versioning details box gone.
 * Heights are the app's, measured at 1440 / 1024 / 390 (the gallery frame is 30 px narrower at 1440).
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { archiveProject, unarchiveProject } from '../../helpers';
import { axeSeriousViolations, describeViolations, resetFakes, test } from '../support';
import {
  captureExperimentPosts,
  nameBox,
  openHome,
  openLaunch,
  review,
  seedLaunch,
  type LaunchFixture,
} from './launchSupport';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const WIDTHS = [1440, 1024, 390] as const;
let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const checkbox = (page: Page) => page.getByRole('checkbox', { name: 'Latency-sensitive run' });
const control = (page: Page) => page.getByTestId('launch-latency');
const envCard = (page: Page) => page.getByTestId('home-latency').locator('xpath=ancestor::*[contains(@class,"card")][1]');

async function box(l: Locator) {
  const b = await l.boundingBox();
  expect(b).toBeTruthy();
  return b!;
}
const round = (n: number) => Math.round(n * 10) / 10;
/** The elements the spec names (block, helper, reason, callout) must not scroll sideways. */
const overflow = (l: Locator) =>
  l.evaluate((el) => {
    const parts = [el, ...Array.from(el.querySelectorAll('p, [role="note"]'))] as HTMLElement[];
    return parts.filter((n) => n.scrollWidth > n.clientWidth + 0.5).map((n) => n.id || n.tagName);
  });

test.describe('home view', () => {
  for (const width of WIDTHS) {
    test(`the control sits in the Environments card after "New environment" at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page, f.project.slug);
      // QA3-10: once, in the Environments card, below the New environment button.
      await expect(control(page)).toHaveCount(1);
      const card = envCard(page);
      await expect(card.getByRole('group', { name: 'Environments' })).toBeVisible();
      await expect(card.getByTestId('launch-latency')).toHaveCount(1);
      const add = await box(card.getByRole('button', { name: 'New environment' }));
      const block = await box(page.getByTestId('home-latency'));
      expect(block.y - (add.y + add.height)).toBeGreaterThanOrEqual(14);
      // QA3-11: a 1 px subtle rule, 14 px above the checkbox.
      const style = await page.getByTestId('home-latency').evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.borderTopWidth, s.paddingTop];
      });
      expect(style).toEqual(['1px', '14px']);
      expect(await overflow(page.getByTestId('home-latency'))).toEqual([]);
      // QA3-12: helper 11 px, indented 24 px.
      const helper = page.locator('#launch-latency-help');
      expect(await helper.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).paddingInlineStart])).toEqual([
        '11px',
        '24px',
      ]);
      const lines = Math.round((await box(helper)).height / 15.4);
      expect(lines).toBe(width === 1440 ? 2 : width === 1024 ? 3 : 4);
      // QA3-13: the Dataset card stretches to the Environments card (side by side).
      const cards = page.locator('[data-testid="launch-home"] > div').first().locator(':scope > *');
      if (width >= 1024) {
        const [a, b] = [await box(cards.nth(0)), await box(cards.nth(1))];
        expect(round(a.height)).toBe(round(b.height));
      }
      // QA3-20: the bar is unchanged and has no latency tag.
      const bar = page.getByRole('region', { name: 'Launch', exact: true });
      await expect(bar.getByTestId('latency-tag')).toHaveCount(0);
      if (width === 1440) expect(Math.round((await box(bar)).height)).toBe(56);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  test('on / off: the warning callout and the environment card height (QA3-14)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug);
    const heights: Record<string, number> = { off: round((await box(envCard(page))).height) };
    await checkbox(page).check({ force: true });
    const callout = page.getByRole('note').filter({ hasText: 'Other jobs wait while this run executes' });
    await expect(callout).toBeVisible();
    heights.on = round((await box(envCard(page))).height);
    heights.callout = round((await box(callout)).height);
    console.log('QA3-13/14 home heights 1440', JSON.stringify(heights));
    expect(heights.callout).toBeCloseTo(34.8, 0);
    expect(heights.on - heights.off).toBeCloseTo(38.8, 0);
  });

  test('no environment, no control; archived project: disabled with the helper only (QA3-10, QA3-16)', async ({
    page,
    request,
  }) => {
    await openHome(page, f.project.slug);
    await expect(control(page)).toHaveCount(1);
    await archiveProject(request, f.project.id);
    try {
      await openHome(page, f.project.slug);
      await expect(checkbox(page)).toBeDisabled();
      await expect(page.getByTestId('launch-latency-reason')).toHaveCount(0);
      await expect(page.locator('#launch-latency-help')).toBeVisible();
    } finally {
      await unarchiveProject(request, f.project.id);
    }
  });

  test('one value: home -> Customize -> back, and Launch as is sends it (QA3-17)', async ({ page, request }) => {
    const posts = captureExperimentPosts(page);
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await nameBox(page).fill('round trip');
    await checkbox(page).check({ force: true });
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page).toHaveURL(/step=where/);
    await expect(checkbox(page)).toBeChecked();
    await expect(control(page)).toHaveCount(1);
    await expect(review(page).getByLabel('Summary')).toContainText('yes');
    await checkbox(page).uncheck({ force: true });
    await page.getByRole('button', { name: /Start/ }).first().click();
    await expect(page).not.toHaveURL(/step=/);
    await expect(checkbox(page)).not.toBeChecked();
    await checkbox(page).check({ force: true });
    await expect(page.getByRole('button', { name: 'Launch as is' })).toBeEnabled({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Launch as is' }).click();
    await expect.poll(() => posts.launches.length).toBe(1);
    expect(posts.launches[0]!.body.latency_sensitive).toBe(true);
    expect(posts.launches[0]!.body).not.toHaveProperty('versioning_details');
    await expect
      .poll(async () =>
        JSON.stringify(await (await request.get(`/v1/projects/${f.project.id}/experiments?latency_sensitive=true`)).json()),
      )
      .toContain('round trip');
  });

  test('a manager never sees a reason; the dry run keeps no latency problem (QA3-15, QA3-24)', async ({ page }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    await expect(checkbox(page)).toBeEnabled();
    await expect(page.getByTestId('launch-latency-reason')).toHaveCount(0);
    await expect(checkbox(page)).toHaveAccessibleDescription(/Starts only when the gateway is quiet/);
  });

  for (const width of [1440, 390] as const) {
    test(`axe: 0 serious violations, off and on, at ${width}px (QA3-19)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHome(page, f.project.slug, `?env=${f.env.id}`);
      expect(describeViolations(await axeSeriousViolations(page))).toBe('');
      await checkbox(page).check({ force: true });
      await expect(page.getByRole('note').filter({ hasText: 'Other jobs wait' })).toBeVisible();
      expect(describeViolations(await axeSeriousViolations(page))).toBe('');
    });
  }
});

test.describe('Customize step 1', () => {
  for (const width of WIDTHS) {
    test(`no Versioning details box; the card is the amended height at ${width}px (QA2-9, QA2-10, QA3-22)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
      const entry = page.getByTestId('launch-entry');
      await expect(entry.locator('textarea')).toHaveCount(0);
      await expect(page.getByLabel('Versioning details')).toHaveCount(0);
      await expect(page.getByText('Versioning details')).toHaveCount(0);
      await expect(page.getByTestId('home-latency')).toHaveCount(0);
      await expect(control(page)).toHaveCount(1);
      const card = page.locator('section[aria-label="Name and priority"]');
      const b = await box(card);
      console.log('QA2-10 card', width, round(b.width), round(b.height));
      const expected = { 1440: 117.6, 1024: 133, 390: 227.1 }[width];
      expect(Math.abs(b.height - expected)).toBeLessThanOrEqual(2);
      // Children: the name and priority row, and the latency block only.
      const kids = await card.evaluate((el) => {
        const stack = el.querySelector('[data-testid="launch-latency"]')!.parentElement!;
        return Array.from(stack.children).map((c) => c.getAttribute('data-testid') ?? c.className.split(' ')[0]);
      });
      console.log('QA2-10 children', JSON.stringify(kids));
      expect(kids).toHaveLength(2);
      expect(kids[1]).toBe('launch-latency');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    });
  }

  test('the same control as on the home view, on and off (QA3-23)', async ({ page }) => {
    await openHome(page, f.project.slug, `?env=${f.env.id}`);
    const home = await control(page).evaluate((el) => el.outerHTML);
    await page.getByRole('button', { name: 'Customize' }).click();
    await expect(page).toHaveURL(/step=where/);
    expect(await control(page).evaluate((el) => el.outerHTML)).toBe(home);
  });
});
