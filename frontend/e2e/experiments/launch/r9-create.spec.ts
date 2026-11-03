/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are untyped JSON here */
/**
 * Round 9, points 1, 3, 4, 5 and 6 of docs/internal/ui-migration/redesign9/experiments.md (C-1-*, C-3-*, C-4-*, C-5-*, C-6-*):
 * the option boxes, the one launch bar, the review on its own step, the runs table and the priority per run.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { expectNoPageOverflow, getExperiment, resetFakes, test, waitForExperiment } from '../support';
import { captureExperimentPosts, goStep, openHome, openLaunch, settled, STEP_LABELS, toReview, type StepId } from './launchSupport';
import { pickSelect } from '../ui';
import { chooseDataset } from './multiSupport';
import {
  bar,
  box,
  cloneUrl,
  computed,
  contrast,
  envBox,
  launchSweep,
  near,
  part,
  seedR9,
  tokenColor,
  type R9Fixture,
} from './r9Support';

test.setTimeout(240_000);
test.use({ actionTimeout: 10_000 });

let f: R9Fixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedR9(request);
});

const STEPS: StepId[] = ['where', 'start', 'models', 'settings', 'evaluation', 'review'];

/** The resolved sRGB colour of any CSS colour (color-mix included) as `rgb(r, g, b)`. */
async function resolved(page: Page, css: string): Promise<string> {
  return page.evaluate((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  }, css);
}

// ───────────────────────────── point 1: boxes ─────────────────────────────

test.describe('point 1: option boxes', () => {
  for (const width of [1440, 1024, 390]) {
    test(`C-1-1, C-1-2, C-1-7 boxes are --bg-elevated on the card, 1px --border-default, padded 8 14 (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openHome(page, f.project.slug, `?env=${f.production.id}`);
      await chooseDataset(page, 'support-tickets');
      await expect(envBox(page, 'production').locator('[data-env-version]')).toHaveAttribute('data-status', 'ok');
      const elevated = await tokenColor(page, '--bg-elevated');
      const surface = await tokenColor(page, '--bg-surface');
      const borderDefault = await tokenColor(page, '--border-default');
      const unselected = envBox(page, 'staging');
      for (const [name, el] of [
        ['env-box', unselected],
        ['dataset-box', part(page, 'dataset-box').first()],
      ] as const) {
        const s = await computed(el, ['background-color', 'border-top-width', 'border-top-color', 'border-top-left-radius', 'padding-top', 'padding-left']);
        expect(s['background-color'], `${name} fill`).toBe(elevated);
        expect(s['border-top-width']).toBe('1px');
        expect(s['border-top-color']).toBe(borderDefault);
        expect(s['border-top-left-radius']).toBe('8px');
        expect(`${s['padding-top']} ${s['padding-left']}`).toBe('8px 14px');
        const c = contrast(s['background-color']!, surface);
        near(c, 1.1, 0.02, `${name} contrast against its card`);
      }
      // ticked box with Versions: 88 ± 6 at 1440 (112 ± 8 at 390 in the mock, whose box has two tags); the Task row left the box.
      // This seed's environment also carries the "Default preset v1" tag, which wraps to a second tag row at 390 (+24 px).
      const ticked = await box(envBox(page, 'production'));
      if (width === 1440) near(ticked.height, 88, 6, 'ticked env-box height');
      if (width === 390) near(ticked.height, 112 + 24, 8, 'ticked env-box height with the preset tag row');
    });
  }

  test('C-1-3 selected = accent border, 3px rail, accent tint; the Start-from card uses the same border and rail', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    const accent = await tokenColor(page, '--accent-primary');
    const selected = envBox(page, 'production');
    await expect(selected).toHaveAttribute('data-state', 'selected');
    await settled(page);
    await expect.poll(async () => (await computed(selected, ['border-inline-start-color']))['border-inline-start-color']).toBe(accent);
    const s = await computed(selected, ['border-top-color', 'border-top-width', 'border-inline-start-width', 'border-inline-start-color', 'background-color']);
    expect(s['border-top-color']).toBe(accent);
    expect(s['border-top-width']).toBe('1px');
    expect(s['border-inline-start-width']).toBe('3px');
    expect(s['border-inline-start-color']).toBe(accent);
    const fill = await resolved(page, s['background-color']!);
    expect(fill).not.toBe(await tokenColor(page, '--bg-elevated'));
    expect(contrast(accent, fill)).toBeGreaterThanOrEqual(6);
    const start = page.locator('[role=radio][aria-checked=true]').first();
    // a colour transition may still be running on the Start-from card: poll until it has settled
    const sides = ['border-inline-start-width', 'border-inline-start-style', 'border-inline-start-color'];
    await expect.poll(async () => computed(start, sides)).toEqual(await computed(selected, sides));
  });

  test('C-1-4 hover is --bg-hover and the cursor stays auto', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    const staging = envBox(page, 'staging');
    await staging.hover({ position: { x: 300, y: 4 } });
    await settled(page);
    const s = await computed(staging, ['background-color', 'cursor']);
    expect(s['background-color']).toBe(await tokenColor(page, '--bg-hover'));
    expect(s['cursor']).toBe('auto');
  });

  test('C-1-5 a flagged box has --error border and rail and an error line that reads', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHome(page, f.project.slug, `?env=${f.production.id},${f.staging.id}`);
    await expect(part(page, 'task-select').getByRole('button')).toBeEnabled();
    await part(page, 'task-select').getByRole('button').click();
    await page.getByRole('option', { name: /Route a ticket/ }).click();
    const flagged = envBox(page, 'staging');
    await expect(flagged).toHaveAttribute('data-state', 'flagged');
    await settled(page);
    const error = await tokenColor(page, '--error');
    await expect.poll(async () => (await computed(flagged, ['border-top-color']))['border-top-color']).toBe(error);
    const s = await computed(flagged, ['border-top-color', 'border-inline-start-width', 'border-inline-start-color', 'background-color']);
    expect(s['border-top-color']).toBe(error);
    expect(s['border-inline-start-width']).toBe('3px');
    expect(s['border-inline-start-color']).toBe(error);
    const line = flagged.locator('[data-part=env-flag]');
    const l = await computed(line, ['color']);
    expect(contrast(await resolved(page, l['color']!), await resolved(page, s['background-color']!))).toBeGreaterThanOrEqual(4.5);
    await expect(flagged.getByRole('checkbox', { name: 'staging' })).toBeChecked();
  });

  for (const width of [1440, 390]) {
    test(`C-1-6 nothing inside the Environments and Datasets cards is darker than what holds it, and text reads (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openHome(page, f.project.slug, `?env=${f.production.id},${f.staging.id}`);
      await chooseDataset(page, 'support-tickets');
      await expect(envBox(page, 'production').locator('[data-env-version]')).toHaveAttribute('data-status', 'ok');
      const findings = await page.evaluate(() => {
        const lum = (rgb: number[]) => {
          const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(rgb[0]!) + 0.7152 * f(rgb[1]!) + 0.0722 * f(rgb[2]!);
        };
        const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true })!;
        const rgba = (css: string): number[] => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = '#000';
          ctx.fillStyle = css;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        };
        const solid = (el: Element | null): number[] | null => {
          if (!el) return null;
          const c = rgba(getComputedStyle(el).backgroundColor);
          return c[3]! > 250 ? c : null;
        };
        const behind = (el: Element): number[] => {
          for (let n: Element | null = el; n; n = n.parentElement) {
            const c = solid(n);
            if (c && n !== el) return c;
          }
          return [16, 16, 24];
        };
        const darker: string[] = [];
        const lowText: string[] = [];
        const roots = Array.from(document.querySelectorAll('[data-part=env-section], [data-part=dataset-section]'));
        for (const root of roots) {
          for (const el of Array.from(root.querySelectorAll('*'))) {
            if (el instanceof SVGElement) continue;
            const mine = solid(el);
            // Tags carry their own tone surface (amended C-1-6: a tone tint is not a hole in the box)
            if (mine && !el.closest('[class*=_tag_]') && lum(mine) + 0.002 < lum(behind(el))) darker.push(`${el.tagName}.${el.className}`.slice(0, 80));
            const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
            if (own) {
              const cs = getComputedStyle(el);
              const fg = rgba(cs.color);
              const bg = mine ?? behind(el);
              const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
              const ratio = (a! + 0.05) / (b! + 0.05);
              if (ratio < 4.5 && cs.opacity === '1') lowText.push(`${ratio.toFixed(2)} ${el.tagName}.${el.className} "${(el.textContent ?? '').slice(0, 20)}"`);
            }
          }
        }
        return { darker, lowText };
      });
      expect(findings.darker, 'darker than the container').toEqual([]);
      expect(findings.lowText, 'text under 4.5:1').toEqual([]);
    });
  }
});

// ───────────────────────────── points 3 and 4: one bar, review on its own step ─────────────────────────────

// Round 10, C-1-1 (amends C-3-2): five slots in this DOM order on every step; the launch is the last step's primary slot.
const PARTS = ['bar-skip', 'bar-cancel', 'bar-status', 'bar-back', 'bar-continue'];

async function barFacts(page: Page) {
  const el = bar(page);
  const style = await computed(el, ['position', 'background-color', 'border-top-color', 'border-top-width', 'border-top-left-radius', 'box-shadow']);
  const b = await box(el);
  const parts: Record<string, number> = {};
  for (const p of PARTS) {
    const r = await box(part(page, p));
    parts[p] = Math.round((p === 'bar-continue' ? r.x + r.width : r.x) * 10) / 10;
  }
  const barButtons = bar(page).locator('button[data-part^=bar-]:not([data-part=bar-ack])');
  const buttons = await barButtons.count();
  const heights = await barButtons.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10));
  const partNames = await el.evaluate((n) => Array.from(n.querySelectorAll('[data-part]')).map((e) => e.getAttribute('data-part')));
  return { style, height: b.height, parts, buttons, heights, partNames };
}

/** The band between the content and the bar (round 10, point 4): the bar's previous sibling, the scroller's overflow. */
async function barGap(page: Page) {
  return bar(page).evaluate((b) => {
    let prev = b.previousElementSibling;
    while (prev && prev.getBoundingClientRect().height === 0) prev = prev.previousElementSibling;
    let scroller: HTMLElement | null = b.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const s = scroller ?? (document.scrollingElement as HTMLElement);
    const r = b.getBoundingClientRect();
    return {
      gap: r.top - (prev?.getBoundingClientRect().bottom ?? 0),
      barBottom: r.bottom,
      overflows: s.scrollHeight > s.clientHeight + 1,
    };
  });
}

test.describe('point 3: one launch bar', () => {
  for (const width of [1440, 1024]) {
    test(`C-3-1, C-3-2, C-3-3, C-3-6 / R10 C-1-1, C-1-2, C-1-11 the same bar on all six steps (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const facts = [];
      for (const step of STEPS) {
        await openLaunch(page, f.project.slug, `?env=${f.production.id},${f.staging.id}`, step);
        await expect(bar(page)).toBeVisible();
        facts.push({ step, ...(await barFacts(page)) });
      }
      const first = facts[0]!;
      for (const x of facts) {
        near(x.height, 56, 1, `${x.step} bar height`);
        expect(x.style, `${x.step} chrome`).toEqual(first.style);
        expect(x.style['position']).toBe('sticky');
        expect(x.buttons, `${x.step} button count`).toBe(4);
        expect(x.partNames, `${x.step} parts in order`).toEqual(PARTS);
        for (const h of x.heights) near(h, 24, 0, `${x.step} button height`);
        for (const p of PARTS) near(x.parts[p]!, first.parts[p]!, 1, `${x.step} x of ${p}`);
      }
      // nothing else sticks to the page bottom: no 42 px step navigation
      await expect(page.getByRole('navigation', { name: 'Step navigation' })).toHaveCount(0);
    });
  }

  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [1440, 1400]] as const) {
    test(`R10 C-4-2, C-4-3 (amends C-3-1) the bar follows the content: 14 px under it when short, at the viewport bottom while it overflows (${width}x${height})`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const q = `?env=${f.production.id},${f.staging.id}`;
      const views: Array<{ where: string; open: () => Promise<void> }> = [
        { where: 'home', open: () => openHome(page, f.project.slug, q) },
        ...STEPS.map((step) => ({ where: step, open: () => openLaunch(page, f.project.slug, q, step) })),
      ];
      for (const v of views) {
        await v.open();
        await expect(bar(page)).toBeVisible();
        await settled(page);
        const m = await barGap(page);
        if (m.overflows) near(m.barBottom, height, 0.5, `${v.where}: overflowing, the bar rides at the viewport bottom`);
        else near(m.gap, 14, 0.5, `${v.where}: short, the bar is 14 px under the content`);
      }
    });
  }

  test('C-3-4 / R10 C-1-3, C-1-4 Skip is disabled on the review step, where the primary slot is the launch', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'models');
    for (const p of ['bar-skip', 'bar-continue']) await expect(part(page, p)).toBeEnabled();
    await expect(part(page, 'bar-continue')).toHaveAttribute('data-action', 'continue');
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'review');
    await expect(part(page, 'bar-skip')).toHaveAttribute('aria-disabled', 'true');
    await expect(part(page, 'bar-skip')).toBeDisabled();
    await expect(part(page, 'bar-continue')).toHaveAttribute('data-action', 'launch');
    await expect(part(page, 'bar-continue')).toHaveText(/^Launch/);
  });

  test('C-3-5 / R10 C-1-3 the launch label counts runs and Back does not move between "Continue" and "Launch 6 runs"', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const x = await launchSweep(request, f);
    await page.goto(cloneUrl(f.project.slug, x.id, 'models'));
    await expect(part(page, 'bar-continue')).toHaveText('Continue');
    const onContinue = await box(part(page, 'bar-back'));
    await page.goto(cloneUrl(f.project.slug, x.id, 'review'));
    await expect(part(page, 'bar-continue')).toHaveText('Launch 6 runs');
    const six = await box(part(page, 'bar-back'));
    near(six.x, onContinue.x, 1, 'Back does not move with the label');
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'review');
    await expect(part(page, 'bar-continue')).toHaveText('Launch');
    near((await box(part(page, 'bar-back'))).x, six.x, 1, 'Back does not move with the run count');
    await expect(part(page, 'bar-continue')).toHaveAttribute('data-variant', 'primary');
    near((await box(part(page, 'bar-continue'))).width, 120, 0.5, 'the primary slot keeps 120 px');
  });

  test('C-3-7 / R10 C-1-9 at 390 the bar has three rows, fits, and shows all four buttons without a menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const step of ['where', 'models', 'review'] as StepId[]) {
      await openLaunch(page, f.project.slug, `?env=${f.production.id},${f.staging.id}`, step);
      const b = await box(bar(page));
      near(b.height, 90.8, 1, `${step} bar at 390 (R10 C-1-9: three rows)`);
      const overflow = await bar(page).evaluate((n) => n.scrollWidth <= n.clientWidth + 0.5);
      expect(overflow).toBe(true);
      await expect(bar(page).locator('button[data-part^=bar-]:not([data-part=bar-ack])')).toHaveCount(4);
      for (const p of ['bar-skip', 'bar-cancel', 'bar-status', 'bar-back', 'bar-continue']) await expect(part(page, p)).toBeVisible();
      const [status, skip, back] = [await box(part(page, 'bar-status')), await box(part(page, 'bar-skip')), await box(part(page, 'bar-back'))];
      expect(skip.y, 'Skip under the status').toBeGreaterThan(status.y + status.height - 1);
      expect(back.y, 'Back on the third row').toBeGreaterThan(skip.y + skip.height - 1);
      await expect(page.getByRole('button', { name: 'More launch options' })).toHaveCount(0);
      await expectNoPageOverflow(page);
    }
  });

  test('C-3-8 the home view uses the same chrome with its own parts', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    const home = await computed(bar(page), ['position', 'background-color', 'border-top-color', 'border-top-left-radius', 'box-shadow']);
    near((await box(bar(page))).height, 56, 1, 'home bar height');
    for (const p of ['bar-name', 'bar-status', 'bar-customize', 'bar-launch']) await expect(part(page, p)).toHaveCount(1);
    await page.getByRole('button', { name: 'Customize →' }).click();
    await expect(part(page, 'bar-back')).toBeVisible();
    await settled(page);
    const wizard = await computed(bar(page), ['position', 'background-color', 'border-top-color', 'border-top-left-radius', 'box-shadow']);
    expect(home).toEqual(wizard);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: /← Start/ }).click();
    await expect(page.getByTestId('launch-home')).toBeVisible();
    // amended C-3-8: at 390 the home bar is three rows (status, name, buttons) of one height, 90.8 px, in every state
    near((await box(bar(page))).height, 90.8, 1, 'home bar at 390');
  });

  test('C-3-8 at 390 the home bar keeps one height (90.8 px): ready, a missing name, a flagged task', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page, f.project.slug, `?env=${f.production.id},${f.staging.id}`);
    await expect(part(page, 'bar-status')).toContainText('runs to launch');
    for (const state of ['name missing (problem text)', 'ready', 'task not offered by staging']) {
      if (state === 'ready') await page.getByRole('textbox', { name: 'Experiment name' }).fill('r9 home bar');
      if (state.startsWith('task')) {
        await part(page, 'task-select').getByRole('button').click();
        await page.getByRole('option', { name: /Route a ticket/ }).click();
        await expect(envBox(page, 'staging')).toHaveAttribute('data-state', 'flagged');
      }
      await expect.poll(async () => Math.round((await box(bar(page))).height * 10) / 10, { message: state }).toBeGreaterThanOrEqual(90);
      near((await box(bar(page))).height, 90.8, 1, `home bar, ${state}`);
      const vh = 844;
      near((await box(bar(page))).y + (await box(bar(page))).height, vh, 0.5, `${state}: at the viewport bottom`);
      await expectNoPageOverflow(page);
    }
  });

  test('C-3-9 Back from step 1 returns to the Start view', async ({ page }) => {
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'where');
    await part(page, 'bar-back').click();
    await expect(page.getByTestId('launch-home')).toBeVisible();
  });
});

test.describe('point 4: the review is on its own step', () => {
  test('C-4-1, C-4-2 the Review card exists on the Review step only and the other steps use the full column', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const step of STEPS) {
      await openLaunch(page, f.project.slug, `?env=${f.production.id},${f.staging.id}`, step);
      await expect(page.getByTestId('review-step')).toHaveCount(step === 'review' ? 1 : 0);
      await expect(page.locator('aside[aria-label="Review"]')).toHaveCount(0);
      if (step !== 'review') {
        const main = await box(page.locator('[data-part=customize]'));
        near(main.width, 1193, 2, `${step} column`);
      }
    }
    // the settings tables get the whole column
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'settings');
    const wrap = page.locator('[data-part=customize] section').first();
    near((await box(wrap)).width, 1193, 2, 'settings section');
  });

  test('C-4-3 / C-4-4 the bar carries the run count and the first problem; the link opens its step; ?step=review still works', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'models');
    // 25 s: the first load of a worker compiles the lazy step chunks in Vite (the race behind the one flaky run in the full folder)
    await expect(part(page, 'bar-status')).toContainText(/1 run to launch/, { timeout: 25_000 });
    await settled(page);
    // the seeded default preset holds no dataset: two problems (the dataset first, then the name)
    await expect(part(page, 'bar-status')).toContainText(/Fix 2 problems first/);
    await part(page, 'bar-status').getByRole('button', { name: /Fix 2 problems first/ }).click();
    await expect(page.getByRole('heading', { name: STEP_LABELS.where, level: 2 })).toBeVisible({ timeout: 25_000 });
    await page.goto(page.url().replace('step=where', 'step=review'));
    await expect(page.getByRole('heading', { name: 'Review and launch', level: 2 })).toBeVisible({ timeout: 25_000 });
  });
});

// ───────────────────────────── points 5 and 6: the review and the priority per run ─────────────────────────────

const runRow = (page: Page, n: number): Locator => page.locator(`[data-part=runs-table] [data-run="${n}"]`);
const prio = (page: Page, n: number): Locator => page.getByRole('button', { name: new RegExp(`Priority of run ${n}`) });

test.describe('points 5 and 6: the review and a priority per run', () => {
  test('C-5-1, C-5-3, C-5-4, C-5-5, C-5-7, C-5-8 Summary rows, one row per run, the varying columns, the cards (1440)', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const x = await launchSweep(request, f);
    await page.goto(cloneUrl(f.project.slug, x.id, 'review'));
    await expect(page.getByTestId('review-step')).toBeVisible();
    await expect(page.locator('[data-part=runs-table] [data-run]')).toHaveCount(6, { timeout: 20_000 });
    // C-5-1: 160 px label column, value column at most the reading measure, rows at least 32 px
    const rows = page.locator('[data-part=review-kv] [data-row]');
    const label = await box(rows.first().locator('dt'));
    near(label.width, 160, 1, 'label column');
    const measure = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:76ch;font-size:var(--font-base)';
      document.body.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return w;
    });
    for (let i = 0; i < (await rows.count()); i++) {
      const dd = await box(rows.nth(i).locator('dd'));
      expect(dd.width).toBeLessThanOrEqual(measure + 1);
      expect((await box(rows.nth(i))).height).toBeGreaterThanOrEqual(31.5);
    }
    // C-5-3: row height 32 ± 1, facts readable without a click
    for (let n = 1; n <= 6; n++) near((await box(runRow(page, n))).height, 32, 1, `run ${n} row`);
    // C-5-4: columns = #, only those that vary, Priority
    const headers = await page.locator('[data-part=runs-table] [role=columnheader]').allInnerTexts();
    // R10 C-2-1: one column per swept setting, named as the form names it
    expect(headers.map((h) => h.replace(/\s+/g, ' ').trim().split(' ')[0]!.toLowerCase()).filter(Boolean)).toEqual(['#', 'environment', 'timeout', 'priority']);
    // C-5-5: 18 px / 700 mono next to "runs to launch"
    const count = await computed(part(page, 'run-count'), ['font-size', 'font-weight', 'font-family']);
    expect(count['font-size']).toBe('18px');
    expect(count['font-weight']).toBe('700');
    expect(count['font-family']).toMatch(/mono/i);
    // C-5-7: Summary, Runs, Changes, Checks are cards; Changes and Checks share a row with a 14 px gap
    for (const name of ['Summary', 'Runs to launch', 'Changes', 'Checks']) await expect(page.getByRole('region', { name, exact: true })).toBeVisible();
    const changes = await box(part(page, 'review-changes'));
    const checks = await box(part(page, 'review-checks'));
    near(changes.y, checks.y, 1, 'Changes and Checks share a row');
    near(checks.x - (changes.x + changes.width), 14, 1, 'gap');
    near(changes.width, checks.width, 1, 'equal columns');
    near(changes.width, 589.5, 0.5, 'Changes column (amended C-5-7: two equal columns of 589.5 px at 1440)');
    near(checks.width, 589.5, 0.5, 'Checks column');
    // C-5-8: nothing under 11 px except tags, no --text-dim
    const dim = await tokenColor(page, '--text-dim');
    const small = await page.evaluate((dimColor) => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('[data-testid=review-step] *'))) {
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
        if (!own || el.closest('[class*=_tag_], [class*=_badge_]')) continue;
        const cs = getComputedStyle(el);
        if (parseFloat(cs.fontSize) < 11) out.push(`size ${cs.fontSize} ${el.tagName}`);
        if (cs.color === dimColor) out.push(`dim ${el.tagName}`);
      }
      return out;
    }, dim);
    expect(small).toEqual([]);
    await expectNoPageOverflow(page);
  });

  test('C-5-9 / R10 C-2-12 the Summary and the first two runs are on the first screen at 1440 x 1000', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const x = await launchSweep(request, f);
    await page.goto(cloneUrl(f.project.slug, x.id, 'review'));
    await expect(page.locator('[data-part=runs-table] [data-run]')).toHaveCount(6, { timeout: 20_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const summary = await box(part(page, 'review-summary'));
    // amended C-5-9 (R10 C-2-12): the Swept settings row and the Versions grid add to the Summary; the first two runs stay above the bar
    const second = await box(runRow(page, 2));
    const top = (await box(bar(page))).y;
    expect(summary.y + summary.height).toBeLessThan(top);
    expect(second.y + second.height).toBeLessThanOrEqual(top);
  });

  test('C-5-2, C-5-6 at 390 the summary stacks and every run is a card with a 96 px label column', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const x = await launchSweep(request, f);
    await page.goto(cloneUrl(f.project.slug, x.id, 'review'));
    await expect(page.locator('[data-part=runs-cards] [data-run]')).toHaveCount(6, { timeout: 20_000 });
    const row = page.locator('[data-part=review-kv] [data-row]').first();
    const dt = await box(row.locator('dt'));
    const dd = await box(row.locator('dd'));
    expect(dd.y).toBeGreaterThan(dt.y); // label above value
    const card = page.locator('[data-part=runs-cards] [data-run="1"]');
    expect((await box(card)).height).toBeLessThanOrEqual(110);
    // C-5-7 at 390: Changes and Checks are stacked, one column each
    const changes = await box(part(page, 'review-changes'));
    const checks = await box(part(page, 'review-checks'));
    expect(checks.y, 'Checks under Changes').toBeGreaterThan(changes.y + changes.height - 1);
    near(checks.x, changes.x, 1, 'one column');
    near(checks.y - (changes.y + changes.height), 14, 1, 'gap');
    const labelWidth = await card.locator('dt').first().evaluate((e) => e.getBoundingClientRect().width);
    near(labelWidth, 96, 1, 'card label column');
    near((await box(card.getByRole('button', { name: /Priority of run 1/ }))).height, 24, 0, 'select height in the card');
    await expectNoPageOverflow(page);
  });

  test('C-6-1, C-6-2, C-6-9 one select per run, 120 x 24, Low / Normal / High, Normal on load, 32 px rows with the marker', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const x = await launchSweep(request, f);
    await page.goto(cloneUrl(f.project.slug, x.id, 'review'));
    await expect(page.locator('[data-part=runs-table] [data-run]')).toHaveCount(6, { timeout: 20_000 });
    await expect(page.locator('[data-part=run-priority]')).toHaveCount(6);
    for (let n = 1; n <= 6; n++) {
      const select = prio(page, n);
      await expect(select).toContainText('Normal');
      const wrap = await box(page.locator('[data-part=run-priority]').nth(n - 1));
      near(wrap.width, 120, 1, `select ${n} width`);
      near((await box(select)).height, 24, 0, `select ${n} height`);
    }
    await expect(page.locator('[data-part=run-changed]')).toHaveCount(0);
    await prio(page, 1).click();
    expect((await page.getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0])).toEqual(['Low', 'Normal', 'High']);
    await page.keyboard.press('Escape');
    await prio(page, 1).click();
    await page.getByRole('option', { name: /^Low/ }).click();
    await expect(page.locator('[data-part=run-changed]')).toHaveCount(1);
    near((await box(runRow(page, 1))).height, 32, 1, 'row with the marker');
  });

  test('C-6-3, C-6-6 High on run 1: only run 1 changes, the dry run names it, the acknowledgement gates Launch, the job stores it', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const x = await launchSweep(request, f);
    const posts = captureExperimentPosts(page);
    await page.goto(cloneUrl(f.project.slug, x.id, 'review'));
    await expect(page.locator('[data-part=runs-table] [data-run]')).toHaveCount(6, { timeout: 20_000 });
    await expect(page.locator('[data-part=review-ack]')).toHaveCount(0);
    await prio(page, 1).click();
    await page.getByRole('option', { name: /^High/ }).click();
    await expect(page.locator('[data-part=run-changed]')).toHaveCount(1);
    await expect(runRow(page, 1).locator('[data-part=run-changed]')).toHaveCount(1);
    await expect
      .poll(() => posts.dryRuns.at(-1)?.body.job_priorities, { timeout: 10_000 })
      .toEqual([{ environment_id: expect.any(String), combo_index: expect.any(Number), dataset_index: 0, priority: 'HIGH' }]);
    const ack = page.locator('[data-part=review-ack]');
    await expect(ack).toContainText('1 run is High.');
    const border = (await computed(ack, ['border-top-color']))['border-top-color'];
    expect(border).toBe(await tokenColor(page, '--warning'));
    await expect(ack.getByRole('checkbox')).not.toBeChecked();
    const launch = page.locator('[data-part=bar-continue][data-action=launch]');
    await expect(launch).toBeDisabled();
    await expect(part(page, 'bar-status')).toContainText('Acknowledge the preemption to launch');
    await ack.getByText('I understand that High runs can preempt other work').click();
    await expect(launch).toBeEnabled({ timeout: 15_000 });
    await launch.click();
    await page.waitForURL(/\/experiments\/[0-9a-f-]{36}/, { timeout: 20_000 });
    expect(posts.launches).toHaveLength(1);
    const body = posts.launches[0]!.body;
    expect(body.acknowledge_preemption).toBe(true);
    expect(body.job_priorities).toHaveLength(1);
    const id = page.url().match(/experiments\/([0-9a-f-]{36})/)![1]!;
    await waitForExperiment(request, f.project.id, id, (e) => e.jobs.length === 6);
    const stored = (await getExperiment(request, f.project.id, id)) as any;
    const byPriority = (stored.jobs as any[]).map((j) => j.priority).sort();
    expect(byPriority).toEqual(['HIGH', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL', 'NORMAL']);
    expect(stored.priorities).toEqual({ LOW: 0, NORMAL: 5, HIGH: 1 });
    // C-6-11: the job table shows each job's own priority, High in the danger tone
    await expect(page.locator('[data-job-priority=HIGH]')).toHaveCount(1);
    await expect(page.locator('[data-job-priority=NORMAL]').first()).toBeVisible();
  });

  test('C-6-5 an environment capped at Normal cannot take High; one capped at High can', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const x = await launchSweep(request, f);
    await page.goto(cloneUrl(f.project.slug, x.id, 'review'));
    await expect(page.locator('[data-part=runs-table] [data-run]')).toHaveCount(6, { timeout: 20_000 });
    const stagingRun = (await runRow(page, 4).innerText()).includes('staging') ? 4 : 1;
    await prio(page, stagingRun).click();
    const high = page.getByRole('option', { name: /^High/ });
    await expect(high).toHaveAttribute('aria-disabled', 'true');
    await expect(high).toContainText('Capped at Normal on staging');
    await page.keyboard.press('Escape');
    const productionRun = stagingRun === 4 ? 1 : 4;
    await prio(page, productionRun).click();
    await expect(page.getByRole('option', { name: /^High/ })).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('C-6-7, C-6-8 "Set every run to" and the experiment-level default', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const x = await launchSweep(request, f);
    await page.goto(cloneUrl(f.project.slug, x.id, 'review'));
    await expect(page.locator('[data-part=runs-table] [data-run]')).toHaveCount(6, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Reset' })).toHaveCount(0);
    await part(page, 'review-priority-all').getByRole('button').click();
    await page.getByRole('option', { name: /^Low/ }).click();
    await expect(page.locator('[data-part=run-changed]')).toHaveCount(6);
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(page.locator('[data-part=run-changed]')).toHaveCount(0);
    // one row changed, then the experiment-level priority: the other rows follow it, the changed row stays
    await prio(page, 2).click();
    await page.getByRole('option', { name: /^Low/ }).click();
    await goStep(page, 'where');
    await pickSelect(page, /Priority/, /^LOW/);
    await toReview(page);
    await expect(page.locator('[data-part=runs-table] [data-run]')).toHaveCount(6, { timeout: 20_000 });
    for (let n = 1; n <= 6; n++) await expect(prio(page, n)).toContainText('Low');
    // run 2 keeps its own choice (it equals the new default now, but it was changed individually): C-6-8 leaves changed rows alone
    await expect(page.locator('[data-part=run-changed]')).toHaveCount(1);
  });

  test('C-6-10 a single run draws no table and sends no job_priorities', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts = captureExperimentPosts(page);
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'where');
    await chooseDataset(page, 'support-tickets');
    await page.getByRole('textbox', { name: 'Experiment name' }).fill('one run');
    await toReview(page);
    await expect(page.getByTestId('review-step')).toBeVisible();
    await expect(page.locator('[data-part=runs-table]')).toHaveCount(0);
    await expect(page.locator('[data-part=run-priority]')).toHaveCount(0);
    await expect.poll(() => posts.dryRuns.length).toBeGreaterThan(0);
    expect(posts.dryRuns.every((d) => d.body.job_priorities === undefined)).toBe(true);
    await expect(part(page, 'review-summary')).toContainText('Normal');
  });
});
