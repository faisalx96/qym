/* eslint-disable @typescript-eslint/no-explicit-any -- dry-run bodies are untyped JSON here */
/**
 * Round 10 of docs/internal/ui-migration/redesign10/experiments.md (C-1-* to C-4-*, amendment L1): the Customize bar's slots
 * (Skip and Cancel at the far left, Back and the primary slot at the far right, no launch shortcut), one run-table column per
 * swept setting, the versioning details as the service reports them, and the bar that follows the content.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  axeSeriousViolations,
  describeViolations,
  expectNoPageOverflow,
  FAKE_A,
  FAKE_B,
  launchExperiment,
  PRIMARY,
  resetFakes,
  setFakeVersioning,
  test,
} from '../support';
import { openHome, openLaunch, settled, type StepId } from './launchSupport';
import { bar, box, cloneUrl, computed, contrast, envBox, near, part, seedR9, type R9Fixture } from './r9Support';

test.setTimeout(240_000);
test.use({ actionTimeout: 10_000 });

let f: R9Fixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedR9(request);
});

const STEPS: StepId[] = ['where', 'start', 'models', 'settings', 'evaluation', 'review'];
const PARTS = ['bar-skip', 'bar-cancel', 'bar-status', 'bar-back', 'bar-continue'];
const both = () => `?env=${f.production.id},${f.staging.id}`;

const MODEL = `/slot_bindings/${PRIMARY}`;
const THRESHOLD = '/env_overrides/MILVUS_SEARCH_THRESHOLD';
const TIMEOUT = '/env_overrides/LLM_OVERRIDES/endpoints/primary/timeout';

/** The round 10 seed: a linked model x threshold axis and a plain timeout axis on both environments (2 x 3 x 2 = 12 runs). */
async function launchTwoAxis(request: APIRequestContext): Promise<string> {
  const res = await request.post(`/v1/projects/${f.project.id}/llm-connections`, {
    data: { name: 'claude-sonnet eval', llm_model: 'claude-sonnet', llm_base_url: 'https://api.example.com/v1', llm_api_key: 'sk-test-0987654321' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const second = ((await res.json()) as { id: string }).id;
  const x = await launchExperiment(request, f.project.id, {
    name: 'model x threshold x timeout',
    environment_ids: [f.staging.id, f.production.id],
    spec: {
      evaluator: { dataset: 'support-tickets', dataset_version: 'v3', config: { samples: 1 } },
      slot_bindings: { [PRIMARY]: { sweep: [{ connection_id: f.connectionId }, { connection_id: second }] } },
      env_overrides: {
        MILVUS_SEARCH_THRESHOLD: { sweep: [0.5, 0.7] },
        LLM_OVERRIDES: { endpoints: { primary: { timeout: { sweep: [10, 30, 60] } } } },
      },
      links: [[MODEL, THRESHOLD]],
    },
  });
  return x.id;
}

async function openTwoAxis(page: Page, request: APIRequestContext, step: StepId = 'review') {
  const id = await launchTwoAxis(request);
  await page.goto(cloneUrl(f.project.slug, id, step));
  if (step === 'review') {
    await expect(page.locator('[data-part=runs-table] [data-run], [data-part=runs-cards] [data-run]')).toHaveCount(12, { timeout: 30_000 });
    await expect(part(page, 'review-swept')).toBeVisible();
  }
  return id;
}

/** The parts of the bar in DOM order with their boxes (x, right, y) and the bar's box. */
async function barParts(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return bar(page).evaluate((b) => {
    const r = (e: Element) => {
      const x = e.getBoundingClientRect();
      return { x: x.x, right: x.right, y: x.y, width: x.width, height: x.height };
    };
    return {
      bar: r(b),
      parts: Array.from(b.querySelectorAll('[data-part]')).map((e) => ({ part: e.getAttribute('data-part')!, ...r(e) })),
      buttons: b.querySelectorAll('button').length,
      links: b.querySelectorAll('[data-part=bar-status] button').length,
    };
  });
}

/** The band between the content and the bar: its previous painted sibling, the scroller's overflow and scroll end. */
async function barGap(page: Page) {
  return bar(page).evaluate((b) => {
    let prev = b.previousElementSibling;
    while (prev && prev.getBoundingClientRect().height === 0) prev = prev.previousElementSibling;
    let s: HTMLElement | null = b.parentElement;
    while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    const scroller = s ?? (document.scrollingElement as HTMLElement);
    const r = b.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    return {
      gap: r.top - (prev?.getBoundingClientRect().bottom ?? 0),
      top: r.top,
      bottom: r.bottom,
      scrollerBottom: Math.min(sr.bottom, innerHeight),
      overflows: scroller.scrollHeight > scroller.clientHeight + 1,
      atEnd: Math.abs(scroller.scrollTop + scroller.clientHeight - scroller.scrollHeight) <= 1,
      // in scroller coordinates: the bar's bottom against the scrollable height (C-4-4)
      barBottomInScroller: r.bottom - sr.top + scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    };
  });
}

async function scrollTo(page: Page, where: 'top' | 'middle' | 'end') {
  await bar(page).evaluate((b, w) => {
    let s: HTMLElement | null = b.parentElement;
    while (s && !/auto|scroll/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
    if (!s) return;
    const max = s.scrollHeight - s.clientHeight;
    s.scrollTop = w === 'top' ? 0 : w === 'middle' ? max / 2 : max;
  }, where);
  await page.waitForTimeout(150);
}

// ───────────────────────────── point 1: the bar's slots ─────────────────────────────

test.describe('R10 point 1: Skip and Cancel at the far left, Back and the primary slot at the far right', () => {
  for (const width of [1440, 1024]) {
    test(`R10 C-1-1, C-1-2, C-1-8, C-1-11 five parts in order at fixed x on all six steps (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const seen: Array<{ step: StepId; m: Awaited<ReturnType<typeof barParts>> }> = [];
      for (const step of STEPS) {
        await openLaunch(page, f.project.slug, both(), step);
        await settled(page);
        seen.push({ step, m: await barParts(page) });
        // C-1-8 the status is centred between the groups
        expect((await computed(part(page, 'bar-status'), ['justify-content']))['justify-content']).toBe('center');
        // C-1-11 chrome
        const style = await computed(bar(page), ['background-color', 'border-top-width', 'position']);
        expect(style['border-top-width']).toBe('1px');
        expect(style['position']).toBe('sticky');
      }
      const first = seen[0]!.m;
      for (const { step, m } of seen) {
        expect(m.parts.map((p) => p.part), `${step} parts`).toEqual(PARTS);
        expect(m.buttons - m.links, `${step} buttons`).toBe(4);
        near(m.bar.height, 56, 1, `${step} bar height`);
        const at = Object.fromEntries(m.parts.map((p) => [p.part, p]));
        near(at['bar-skip']!.x - m.bar.x, 15, 1, `${step} Skip at the far left`);
        near(m.bar.right - at['bar-continue']!.right, 15, 1, `${step} primary at the far right`);
        near(at['bar-cancel']!.x, at['bar-skip']!.right + 8, 1, `${step} Cancel after Skip`);
        near(at['bar-back']!.right, at['bar-continue']!.x - 8, 1, `${step} Back before the primary`);
        expect(at['bar-cancel']!.right + 14, `${step} status after Cancel`).toBeLessThanOrEqual(at['bar-status']!.x + 0.5);
        expect(at['bar-status']!.right + 14, `${step} status before Back`).toBeLessThanOrEqual(at['bar-back']!.x + 0.5);
        for (const p of m.parts) {
          const p0 = first.parts.find((q) => q.part === p.part)!;
          near(p.x, p0.x, 1, `${step} x of ${p.part}`);
        }
        await expect(page.locator('[data-part=bar-launch]')).toHaveCount(0);
      }
    });
  }

  test('R10 C-1-1, C-1-3 the preset editor has the same five parts; Continue on its steps, Publish v2 on the last', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const editor = (step: string) => `/projects/${f.project.slug}/environments/${f.production.id}/default-preset/edit?step=${step}`;
    for (const step of ['where', 'models', 'settings', 'evaluation', 'review']) {
      await page.goto(editor(step));
      await expect(page.locator('[data-part=customize][data-mode=editor]')).toBeVisible({ timeout: 25_000 });
      const m = await barParts(page);
      expect(m.parts.map((p) => p.part), `editor ${step}`).toEqual(PARTS);
      const primary = part(page, 'bar-continue');
      if (step === 'review') {
        await expect(primary).toHaveAttribute('data-action', 'publish');
        await expect(primary).toHaveText('Publish v2');
        await expect(primary).toHaveAttribute('data-variant', 'primary');
        await expect(part(page, 'bar-skip')).toBeDisabled();
        await expect(part(page, 'bar-skip')).toHaveAttribute('aria-label', 'Skip to review and publish');
      } else {
        await expect(primary).toHaveAttribute('data-action', 'continue');
        await expect(primary).toHaveText('Continue');
        await expect(page.getByRole('button', { name: /^Publish/ })).toHaveCount(0);
      }
    }
  });

  test('R10 C-1-3, C-1-4, C-1-5 the primary slot, Skip disabled in place on the review, Cancel and Back', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await openTwoAxis(page, request, 'models');
    const primary = part(page, 'bar-continue');
    await expect(primary).toHaveAttribute('data-action', 'continue');
    await expect(primary).toHaveText('Continue');
    await expect(primary).toHaveAttribute('data-variant', 'neutral');
    await expect(primary).toHaveAttribute('aria-label', 'Continue to environment configurations');
    expect((await computed(primary, ['min-inline-size']))['min-inline-size']).toBe('120px');
    await expect(part(page, 'bar-skip')).toBeEnabled();
    await expect(part(page, 'bar-skip')).toHaveText('Skip to review');
    await expect(part(page, 'bar-skip')).toHaveAttribute('aria-label', 'Skip to review and launch');
    const backOnContinue = (await box(part(page, 'bar-back'))).x;
    const skipOnContinue = (await box(part(page, 'bar-skip'))).x;
    // a problem never blocks moving on (D10-2): empty the name, Continue stays enabled
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'where');
    await expect(part(page, 'bar-status')).toContainText(/problem/, { timeout: 15_000 });
    await expect(part(page, 'bar-continue')).toBeEnabled();
    await page.goto(cloneUrl(f.project.slug, id, 'review'));
    await expect(primary).toHaveText('Launch 12 runs', { timeout: 30_000 });
    await expect(primary).toHaveAttribute('data-action', 'launch');
    await expect(primary).toHaveAttribute('data-variant', 'primary');
    near((await box(part(page, 'bar-back'))).x, backOnContinue, 1, 'Back does not move between Continue and Launch 12 runs');
    const skip = part(page, 'bar-skip');
    await expect(skip).toBeDisabled();
    await expect(skip).toHaveAttribute('aria-disabled', 'true');
    near((await box(skip)).x, skipOnContinue, 1, 'Skip is drawn in place');
    // Back from step 1 leads to the start view; Cancel to the experiments list
    await openLaunch(page, f.project.slug, both(), 'where');
    await part(page, 'bar-back').click();
    await expect(page.getByTestId('launch-home')).toBeVisible();
    await openLaunch(page, f.project.slug, both(), 'settings');
    await part(page, 'bar-cancel').click();
    await expect(page).toHaveURL(new RegExp(`/projects/${f.project.slug}/experiments(\\?.*)?$`));
  });

  for (const width of [1440, 390]) {
    test(`R10 C-1-6 no launch before the review step (${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const step of STEPS.slice(0, 5)) {
        await openLaunch(page, f.project.slug, both(), step);
        await expect(page.getByRole('button', { name: /^(Launch|Publish)/ }), step).toHaveCount(0);
      }
      await openLaunch(page, f.project.slug, both(), 'review');
      await expect(page.getByRole('button', { name: /^Launch/ })).toHaveCount(1);
    });
  }

  test('R10 C-1-7 the Tab order is the visual order; Enter on Continue opens the next step and focuses its heading', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'models');
    await expect(part(page, 'bar-status').getByRole('button')).toHaveCount(1, { timeout: 15_000 });
    await part(page, 'bar-skip').focus();
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement?.getAttribute('data-part') ?? (document.activeElement?.closest('[data-part]')?.getAttribute('data-part') ?? '') + ':link'));
    }
    expect(order).toEqual(['bar-cancel', 'bar-status:link', 'bar-back', 'bar-continue']);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Environment configurations', level: 2 })).toBeFocused();
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'review');
    await part(page, 'bar-cancel').focus();
    await page.keyboard.press('Tab');
    const next = await page.evaluate(() => document.activeElement?.getAttribute('data-part') ?? (document.activeElement?.closest('[data-part]')?.getAttribute('data-part') ?? '') + ':link');
    expect(['bar-status:link', 'bar-back']).toContain(next);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    // Skip is out of the order on the review: Shift+Tab from Cancel leaves the bar
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-part'))).not.toBe('bar-skip');
  });

  test('R10 C-1-8 the status is start-aligned at 390', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openLaunch(page, f.project.slug, both(), 'models');
    expect((await computed(part(page, 'bar-status'), ['justify-content']))['justify-content']).toBe('flex-start');
  });

  test('R10 C-1-9 at 390 three rows of 90.8 px in launch and editor mode, the status one line, no overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const urls = [
      ...STEPS.map((s) => `/projects/${f.project.slug}/experiments/new${both()}&step=${s}`),
      ...['where', 'models', 'review'].map((s) => `/projects/${f.project.slug}/environments/${f.production.id}/default-preset/edit?step=${s}`),
    ];
    for (const url of urls) {
      await page.goto(url);
      await expect(bar(page)).toBeVisible({ timeout: 25_000 });
      await expect(part(page, 'bar-status')).not.toBeEmpty();
      await page.waitForTimeout(800);
      const m = await barParts(page);
      near(m.bar.height, 90.8, 1, `${url} bar`);
      const at = Object.fromEntries(m.parts.map((p) => [p.part, p]));
      near(at['bar-status']!.height, 20, 4, `${url} status is one line`);
      expect(at['bar-skip']!.y, 'row 2 under the status').toBeGreaterThan(at['bar-status']!.y + at['bar-status']!.height - 1);
      near(at['bar-cancel']!.y, at['bar-skip']!.y, 1, 'Skip and Cancel share row 2');
      expect(at['bar-back']!.y, 'row 3').toBeGreaterThan(at['bar-skip']!.y + at['bar-skip']!.height - 1);
      near(at['bar-continue']!.y, at['bar-back']!.y, 1, 'Back and the primary share row 3');
      near(m.bar.right - at['bar-continue']!.right, 9, 1, 'the primary at the end of row 3');
      await expect(part(page, 'bar-skip')).toHaveText('Skip');
      expect(await bar(page).evaluate((n) => n.scrollWidth <= n.clientWidth + 0.5)).toBe(true);
    }
    await expectNoPageOverflow(page);
  });

  test('R10 C-1-10 the home bar is unchanged: name, status, Customize, Launch as is; 56 / 90.8 px', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page, f.project.slug, both());
    const m = await barParts(page);
    expect(m.parts.map((p) => p.part).filter((p) => p.startsWith('bar-'))).toEqual(['bar-name', 'bar-status', 'bar-customize', 'bar-launch']);
    await expect(part(page, 'bar-launch')).toHaveText('Launch as is');
    near(m.bar.height, 56, 1, 'home bar');
    expect((await computed(part(page, 'bar-status'), ['justify-content']))['justify-content']).toBe('flex-start');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    near((await box(bar(page))).height, 90.8, 1, 'home bar at 390');
  });
});

// ───────────────────────────── point 2: swept settings as columns ─────────────────────────────

/** The runs table's facts: header texts and widths, the band, the scroller. */
async function runsTable(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  return part(page, 'runs-table').evaluate((t) => {
    const rows = Array.from(t.querySelectorAll('thead tr'));
    const head = rows[rows.length - 1]!;
    const ths = Array.from(head.querySelectorAll('th'));
    const band = rows.length > 1 ? Array.from(rows[0]!.querySelectorAll('th')) : [];
    const sc = Array.from(t.querySelectorAll<HTMLElement>('*')).find((e) => /auto|scroll/.test(getComputedStyle(e).overflowX)) ?? t;
    return {
      headers: ths.map((h) => (h as HTMLElement).innerText.replace(/\s+/g, ' ').trim()),
      widths: ths.map((h) => h.getBoundingClientRect().width),
      band: band.map((h) => ({ text: (h as HTMLElement).innerText.trim(), width: h.getBoundingClientRect().width })),
      scrollWidth: sc.scrollWidth,
      clientWidth: sc.clientWidth,
    };
  });
}

test.describe('R10 point 2: one column per swept setting', () => {
  for (const width of [1440, 1024]) {
    test(`R10 C-2-1, C-2-2, C-2-3, C-2-4, C-2-5, C-2-11 the two-axis seed (${width}px)`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 1000 });
      await openTwoAxis(page, request);
      const t = await runsTable(page);
      expect(t.headers).toEqual(['#', 'ENVIRONMENT', 'Primary model', 'Milvus Search Threshold', 'Timeout', 'PRIORITY']);
      await expect(page.locator('[data-part=runs-table] th', { hasText: /Swept setting/i })).toHaveCount(0);
      // C-2-2 the name as written, never uppercased or clipped
      const heads = page.locator('[data-part=axis-header]');
      await expect(heads).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        const h = heads.nth(i);
        expect((await computed(h, ['text-transform']))['text-transform']).toBe('none');
        expect(await h.evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
      }
      // C-2-3 the linked band spans its two members
      const linked = t.band.find((b) => b.text === 'Linked: vary together');
      expect(linked, 'linked band').toBeTruthy();
      near(linked!.width, t.widths[2]! + t.widths[3]!, 1, 'band = Primary model + Milvus Search Threshold');
      expect(t.band.filter((b) => b.text && b.text !== 'Linked: vary together')).toEqual([]);
      // C-2-4 the values the user picked, 12 px, no tags, never clipped
      const run1 = page.locator('[data-part=runs-table] [data-run="1"] [data-part=axis-cell]');
      expect(await run1.allInnerTexts()).toEqual(['gpt-4o prod', '0.5', '10']);
      const cells = page.locator('[data-part=runs-table] [data-part=axis-cell]');
      const facts = await cells.evaluateAll((els) =>
        els.map((e) => ({
          size: getComputedStyle(e).fontSize,
          mono: /mono/i.test(getComputedStyle(e).fontFamily),
          text: (e as HTMLElement).innerText,
          tags: e.querySelectorAll('[class*=_tag_]').length,
          fits: (e.parentElement as HTMLElement).scrollWidth <= (e.parentElement as HTMLElement).clientWidth + 0.5,
        })),
      );
      expect(facts).toHaveLength(36);
      for (const c of facts) {
        expect(c.size).toBe('12px');
        expect(c.tags).toBe(0);
        expect(c.fits, `${c.text} fits its cell`).toBe(true);
        if (/^[\d.]+$/.test(c.text)) expect(c.mono, `${c.text} mono`).toBe(true);
      }
      // C-2-5 widths
      near(t.widths[0]!, 48, 1, '# column');
      near(t.widths[5]!, 240, 1, 'Priority');
      for (const w of t.widths.slice(1, 5)) expect(w).toBeGreaterThanOrEqual(120);
      if (width === 1440) for (const w of t.widths.slice(2, 5)) near(w, t.widths[1]!, 1, 'the four flex columns share the rest');
      expect(t.scrollWidth, 'no horizontal scroll').toBeLessThanOrEqual(t.clientWidth);
      // C-2-11 one 32 px row per run, a select each, no disclosure
      const rows = page.locator('[data-part=runs-table] [data-run]');
      await expect(rows).toHaveCount(12);
      for (let n = 0; n < 12; n++) near((await box(rows.nth(n))).height, 32, 1, `row ${n + 1}`);
      await expect(page.locator('[data-part=run-priority]')).toHaveCount(12);
      await expect(part(page, 'runs-table').locator('[aria-expanded]')).toHaveCount(0);
    });
  }

  test('R10 C-2-8, C-2-9, C-2-12 the Summary row, the Changes row and the first screen (1440 x 1000)', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openTwoAxis(page, request);
    const rows = await page.locator('[data-part=review-kv] [data-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row')));
    const at = (k: string) => rows.indexOf(k);
    expect(at('swept')).toBeGreaterThan(at('ds'));
    expect(at('swept')).toBeLessThan(at('prio'));
    const lines = page.locator('[data-part=swept-axis]');
    expect(await lines.allTextContents()).toEqual([
      'Primary model + Milvus Search Threshold: gpt-4o prod + 0.5, claude-sonnet eval + 0.7 linked',
      'Timeout: 10, 30, 60',
    ]);
    near((await box(page.locator('[data-row=swept]'))).height, 70.6, 4, 'Swept settings row');
    await expect(part(page, 'review-changes')).toContainText('Sweeps: Primary model + Milvus Search Threshold (linked), Timeout');
    await expect(part(page, 'review-changes').getByRole('button', { name: 'Edit' }).first()).toBeVisible();
    // C-2-12 with no High run: the Summary, the runs header and the first two rows above the bar
    await scrollTo(page, 'top');
    const top = (await box(bar(page))).y;
    const summary = await box(part(page, 'review-summary'));
    expect(summary.y + summary.height).toBeLessThan(top);
    const second = await box(page.locator('[data-part=runs-table] [data-run="2"]'));
    expect(second.y + second.height).toBeLessThanOrEqual(top);
  });

  test('R10 C-2-10 at 390 twelve cards, one fact per swept column, 160 px', async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTwoAxis(page, request);
    const cards = page.locator('[data-part=runs-cards] [data-run]');
    await expect(cards).toHaveCount(12);
    const first = cards.first();
    expect(await first.locator('dt').allInnerTexts()).toEqual(['Run', 'Environment', 'Primary model', 'Milvus Search Threshold', 'Timeout', 'Priority']);
    expect(await first.locator('[data-part=axis-cell]').allInnerTexts()).toEqual(['gpt-4o prod', '0.5', '10']);
    near(await first.locator('dt').first().evaluate((e) => e.getBoundingClientRect().width), 96, 1, 'label column');
    near((await box(first)).height, 160, 6, 'card');
    await expectNoPageOverflow(page);
  });

  /** Answers the review's dry runs with `n` swept pointers of two values each on `envs` environments. */
  async function fakeAxes(page: Page, n: number, envs: number, names?: string[]) {
    const pointers = names ?? Array.from({ length: n }, (_, i) => `/env_overrides/R10_SETTING_${i + 1}`);
    await page.route(/\/v1\/projects\/[^/]+\/experiments$/, async (route) => {
      const body = route.request().postDataJSON();
      if (!body?.dry_run) return route.continue();
      const res = await route.fetch();
      const json = (await res.json()) as any;
      const environments = (json.jobs ?? []).slice(0, 1).concat((json.jobs ?? []).slice(1)).map((j: any) => [j.environment_id, j.environment_name]);
      const unique = Array.from(new Map(environments as Array<[string, string]>).entries()).slice(0, envs);
      const jobs: any[] = [];
      for (const step of [0, 1])
        for (const [id, name] of unique)
          jobs.push({
            ...(json.jobs?.[0] ?? {}),
            environment_id: id,
            environment_name: name,
            combo_index: step,
            label: '',
            params: { sweep: Object.fromEntries(pointers.map((p, i) => [p, step ? 1000 + i : 10 + i])) },
          });
      return route.fulfill({
        json: {
          ...json,
          ok: true,
          errors: [],
          axes: [{ pointers, linked: true, length: 2, values: [pointers.map((_, i) => 10 + i), pointers.map((_, i) => 1000 + i)] }],
          jobs,
          job_count: jobs.length,
        },
      });
    });
  }

  for (const [width, fits] of [
    [1440, 6],
    [1024, 3],
  ] as const) {
    test(`R10 C-2-6 with Environment: ${fits} swept columns fit at ${width}px, ${fits + 1} scroll; without it one more fits`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = await launchTwoAxis(request);
      const check = async (n: number, envs: number, scroll: boolean) => {
        await page.unroute(/\/v1\/projects\/[^/]+\/experiments$/);
        await fakeAxes(page, n, envs);
        await page.goto(cloneUrl(f.project.slug, id, 'review'));
        await expect(page.locator('[data-part=runs-table] [data-part=axis-header]')).toHaveCount(n, { timeout: 30_000 });
        const t = await runsTable(page);
        expect(t.scrollWidth > t.clientWidth, `${n} swept, ${envs} env: ${t.scrollWidth}/${t.clientWidth}`).toBe(scroll);
        const flex = t.widths.slice(1, -1);
        for (const w of flex) expect(w).toBeGreaterThanOrEqual(119.5);
        const clipped = await page.locator('[data-part=runs-table] [data-part=axis-header], [data-part=runs-table] [data-part=axis-cell]').evaluateAll((els) =>
          els.filter((e) => e.scrollWidth > e.clientWidth + 0.5 || getComputedStyle(e).textOverflow === 'ellipsis').length,
        );
        expect(clipped).toBe(0);
      };
      await check(fits, 2, false);
      await check(fits + 1, 2, true);
      await check(fits + 1, 1, false);
    });
  }

  test('R10 C-2-7 one environment draws no Environment column', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await launchTwoAxis(request);
    await fakeAxes(page, 2, 1);
    await page.goto(cloneUrl(f.project.slug, id, 'review'));
    await expect(page.locator('[data-part=runs-table] [data-part=axis-header]')).toHaveCount(2, { timeout: 30_000 });
    const t = await runsTable(page);
    expect(t.headers[0]).toBe('#');
    expect(t.headers).not.toContain('ENVIRONMENT');
    expect(t.headers.at(-1)).toBe('PRIORITY');
  });

  test('R10 C-2-2 two columns of one name carry their sections on a second line', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await launchTwoAxis(request);
    await fakeAxes(page, 2, 2, [TIMEOUT, '/env_overrides/LLM_OVERRIDES/endpoints/judge/timeout']);
    await page.goto(cloneUrl(f.project.slug, id, 'review'));
    const heads = page.locator('[data-part=runs-table] [data-part=axis-header]');
    await expect(heads).toHaveCount(2, { timeout: 30_000 });
    const sections = page.locator('[data-part=runs-table] [data-part=axis-section]');
    await expect(sections).toHaveCount(2);
    const texts = await sections.allInnerTexts();
    expect(texts[0]).not.toBe(texts[1]);
    const style = await computed(sections.first(), ['font-size', 'font-weight', 'color']);
    expect(style['font-size']).toBe('11px');
    expect(style['font-weight']).toBe('400');
    for (let i = 0; i < 2; i++) expect(await heads.nth(i).evaluate((e) => e.scrollWidth <= e.clientWidth + 0.5)).toBe(true);
  });

  test('R10 C-2-8 no Swept settings row when nothing is swept', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'review');
    await expect(part(page, 'review-summary')).toBeVisible();
    await expect(page.locator('[data-row=swept]')).toHaveCount(0);
  });
});

// ───────────────────────────── point 3: versions as reported ─────────────────────────────

const V2 = { agent_version: 'agent-1.5.0', kb_version: 'kb-81' };
const V3 = { agent_version: 'agent-1.4.2', image_version: 'img-20261001', kb_version: 'kb-77' };
const V1 = { release: '2026.11.0' };
const ROUTING = { primary: 'gpt-4o', fallback: 'claude-sonnet', judge: 'gpt-4o-mini' };
const V5 = { agent_version: 'agent-1.5.0', kb_version: 'kb-81', prompt_set: 'prompts-2026-11-01', model_routing: ROUTING, build: 4127 };

const versionsOf = (page: Page, env: string) => envBox(page, env).locator('[data-env-version]');

async function versionFacts(page: Page, env: string) {
  await page.evaluate(() => document.fonts.ready);
  return versionsOf(page, env).evaluate((line) => {
    const grid = line.querySelector('dl');
    const cells = Array.from(line.querySelectorAll('dl > div'));
    const boxes = cells.map((c) => c.getBoundingClientRect());
    let overlap = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) overlap++;
      }
    const li = line.closest('li')!;
    return {
      status: line.getAttribute('data-status'),
      keys: Array.from(line.querySelectorAll('[data-part=version-key]')).map((k) => (k as HTMLElement).innerText),
      keysClipped: Array.from(line.querySelectorAll('[data-part=version-key]')).filter((k) => k.scrollWidth > k.clientWidth + 0.5 || getComputedStyle(k).textOverflow === 'ellipsis').length,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter((x) => x.endsWith('px')).length : 0,
      gridWidth: grid ? grid.getBoundingClientRect().width : 0,
      boxHeight: li.getBoundingClientRect().height,
      overlap,
      firstChild: (line.firstElementChild as HTMLElement).innerText,
      spacers: line.querySelectorAll('dl [aria-hidden=true]').length,
    };
  });
}

test.describe('R10 point 3: versioning details as the service reports them', () => {
  test('R10 C-3-1 two keys: two cells, no image, no "not set"; five keys in the response order', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setFakeVersioning(request, FAKE_A, V2);
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(versionsOf(page, 'production')).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
    expect((await versionFacts(page, 'production')).keys).toEqual(['agent_version', 'kb_version']);
    await expect(versionsOf(page, 'production')).not.toContainText(/image|not set/);
    await setFakeVersioning(request, FAKE_A, V5);
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    await expect(versionsOf(page, 'production')).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
    expect((await versionFacts(page, 'production')).keys).toEqual(['agent_version', 'kb_version', 'prompt_set', 'model_routing', 'build']);
  });

  test('R10 C-3-2 values: tags for strings, mono scalars, compact JSON cut at 48 with the whole in its title, wide cells', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setFakeVersioning(request, FAKE_A, V5);
    await openHome(page, f.project.slug, `?env=${f.production.id}`);
    const line = versionsOf(page, 'production');
    await expect(line).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
    const values = line.locator('[data-part=version-value]');
    await expect(values).toHaveCount(5);
    expect(await values.nth(0).getAttribute('class')).toMatch(/tag/i);
    await expect(values.nth(0)).toHaveText('agent-1.5.0');
    const json = JSON.stringify(ROUTING);
    await expect(values.nth(3)).toHaveText(`${json.slice(0, 48)}…`);
    await expect(values.nth(3)).toHaveAttribute('title', json);
    const scalar = await computed(values.nth(4), ['font-family', 'font-size']);
    expect(scalar['font-family']).toMatch(/mono/i);
    expect(scalar['font-size']).toBe('12px');
    expect(await line.locator('[data-wide] [data-part=version-key]').allInnerTexts()).toEqual(['prompt_set', 'model_routing']);
    const grid = await box(line.locator('dl'));
    for (const k of ['prompt_set', 'model_routing']) {
      const cell = line.locator('[data-wide]').filter({ hasText: k });
      near((await box(cell)).width, grid.width, 1, `${k} spans the row`);
    }
  });

  for (const [width, cols, boxW] of [
    [1440, 5, 547],
    [1024, 3, 339],
    [390, 2, 237],
  ] as const) {
    test(`R10 C-3-3, C-3-4, C-3-7 the grid, the loading frame and the box at ${width}px`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 1000 });
      await setFakeVersioning(request, FAKE_A, V5);
      await openHome(page, f.project.slug, `?env=${f.production.id}`);
      await expect(versionsOf(page, 'production')).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
      const five = await versionFacts(page, 'production');
      expect(five.firstChild).toBe('Versions');
      near(five.gridWidth, boxW, 2, 'grid width = the box content width');
      expect(five.columns).toBe(cols);
      expect(five.keysClipped).toBe(0);
      expect(five.overlap).toBe(0);
      // the loading frame against 1, 2 and 3 keys (L1: equal at 1440 and 1024; at 390 for 1 and 2 keys)
      for (const [name, payload] of [
        ['one', V1],
        ['two', V2],
        ['three', V3],
      ] as const) {
        await setFakeVersioning(request, FAKE_A, payload);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((r) => (release = r));
        await page.route('**/versioning-details', async (route) => {
          await gate;
          await route.continue();
        });
        await openHome(page, f.project.slug, `?env=${f.production.id}`);
        const frame = versionsOf(page, 'production').locator('[aria-busy="true"]');
        await expect(frame).toHaveCount(1);
        const placeholders = frame.locator('[data-part=version-placeholder]');
        await expect(placeholders).toHaveCount(3);
        const ys = await placeholders.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)));
        expect(new Set(ys).size, 'one row').toBe(1);
        expect(await placeholders.evaluateAll((els) => els.every((e) => e.getAttribute('aria-hidden') === 'true'))).toBe(true);
        expect((await frame.innerText()).replace(/\s/g, '')).toBe('');
        await page.waitForTimeout(200);
        const loading = (await box(envBox(page, 'production'))).height;
        release();
        await expect(versionsOf(page, 'production')).toHaveAttribute('data-status', 'ok');
        await page.waitForTimeout(200);
        const facts = await versionFacts(page, 'production');
        await page.unroute('**/versioning-details');
        expect(facts.spacers, 'no spacer cells (L1)').toBe(0);
        if (width !== 390 || name !== 'three') near(facts.boxHeight, loading, 1, `${name}: loading = loaded`);
        // C-3-7 (amended: 124.6 at 390 for one or two keys)
        if (width !== 390) near(facts.boxHeight, 124.6, 2, `${name} box`);
        else near(facts.boxHeight, name === 'three' ? 166 : 124.6, 2, `${name} box at 390`);
      }
    });
  }

  test('R10 C-3-5, C-3-6 an empty payload, an older service and an unreadable one', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const answer = (status: string, extra: Record<string, unknown> = {}) => ({
      environment_id: 'x',
      status,
      versioning_details: {},
      error: null,
      fetched_at: null,
      ...extra,
    });
    await page.route(`**/eval-environments/${f.production.id}/versioning-details`, (route) => route.fulfill({ json: answer('ok') }));
    await page.route(`**/eval-environments/${f.staging.id}/versioning-details`, (route) => route.fulfill({ json: answer('unsupported') }));
    await openHome(page, f.project.slug, both());
    const empty = versionsOf(page, 'production');
    await expect(empty).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
    await expect(empty).toContainText('No versioning details reported');
    await expect(empty.locator('[data-part=version-key]')).toHaveCount(0);
    const note = empty.getByText('No versioning details reported');
    expect((await computed(note, ['font-size']))['font-size']).toBe('11px');
    near((await box(envBox(page, 'production'))).height, 107.2, 2, 'empty box');
    const old = versionsOf(page, 'staging');
    await expect(old).toContainText('Versions');
    await expect(old).toContainText('Not supported by this environment (its Evaluation Service is older than v1.2).');
    await page.unroute(`**/eval-environments/${f.staging.id}/versioning-details`);
    await page.route(`**/eval-environments/${f.staging.id}/versioning-details`, (route) => route.fulfill({ json: answer('error', { error: 'kb offline' }) }));
    await openHome(page, f.project.slug, both());
    await expect(versionsOf(page, 'staging')).toContainText('Couldn’t read: kb offline', { timeout: 15_000 });
    expect(await versionsOf(page, 'staging').evaluate((l) => (l.firstElementChild as HTMLElement).innerText)).toBe('Versions');
  });

  test('R10 C-3-8 the review row: the same grid per environment, every reported key', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await setFakeVersioning(request, FAKE_A, V2);
    await setFakeVersioning(request, FAKE_B, V3);
    await openTwoAxis(page, request);
    const row = page.locator('[data-row=versions]');
    const envs = row.locator('[data-part=review-versions-env]');
    await expect(envs).toHaveCount(2);
    const prod = row.locator('[data-env=production]');
    const stag = row.locator('[data-env=staging]');
    await expect(prod.locator('[data-part=version-key]')).toHaveCount(2, { timeout: 15_000 });
    expect(await prod.locator('[data-part=version-key]').allInnerTexts()).toEqual(['agent_version', 'kb_version']);
    expect(await stag.locator('[data-part=version-key]').allInnerTexts()).toEqual(['agent_version', 'image_version', 'kb_version']);
    await expect(prod).toContainText('production');
    near((await box(row)).height, 106.8, 4, 'Versions row');
  });

  test('R10 C-3-11 axe and contrast with the five-key payload', async ({ page, request }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await setFakeVersioning(request, FAKE_A, V5);
      await openHome(page, f.project.slug, `?env=${f.production.id}`);
      await expect(versionsOf(page, 'production')).toHaveAttribute('data-status', 'ok', { timeout: 15_000 });
      expect(describeViolations(await axeSeriousViolations(page))).toBe('');
      const key = versionsOf(page, 'production').locator('[data-part=version-key]').first();
      const color = (await computed(key, ['color']))['color']!;
      const ground = await envBox(page, 'production').evaluate((li) => {
        // the selected box's resolved fill: draw its background over the card's
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        const ctx = c.getContext('2d')!;
        const card = getComputedStyle(li.closest('[class*=card], section') ?? document.body).backgroundColor;
        ctx.fillStyle = card;
        ctx.fillRect(0, 0, 1, 1);
        ctx.fillStyle = getComputedStyle(li).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        return `rgb(${r}, ${g}, ${b})`;
      });
      expect(contrast(color, ground), `key contrast at ${width}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

// ───────────────────────────── point 4: the bar follows the content ─────────────────────────────

test.describe('R10 point 4: the bar follows the content', () => {
  test('R10 C-4-1 the bar is in flow and sticky; the page does not stretch', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await openLaunch(page, f.project.slug, both(), 'start');
    const style = await computed(bar(page), ['margin-top', 'margin-bottom', 'position', 'bottom']);
    expect(style).toEqual({ 'margin-top': '0px', 'margin-bottom': '-32px', position: 'sticky', bottom: '0px' });
    const grow = await bar(page).evaluate((b) => {
      const out: Record<string, string> = {};
      const main = b.parentElement!;
      const layout = main.parentElement!;
      const pageEl = layout.parentElement!;
      out['main'] = getComputedStyle(main).flexGrow;
      out['layout'] = getComputedStyle(layout).flexGrow;
      out['page'] = getComputedStyle(pageEl).minHeight;
      return out;
    });
    expect(grow).toEqual({ main: '0', layout: '0', page: '0px' });
    await openHome(page, f.project.slug, both());
    expect(await page.getByTestId('launch-home').evaluate((e) => getComputedStyle(e).flexGrow)).toBe('0');
  });

  for (const height of [1400, 900]) {
    test(`R10 C-4-2 short content: the bar 14 px under the last card (1440 x ${height})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height });
      const views: Array<[string, () => Promise<void>]> = [
        ['home, nothing ticked', () => openHome(page, f.project.slug)],
        ['home, production', () => openHome(page, f.project.slug, `?env=${f.production.id}`)],
        ['home, both', () => openHome(page, f.project.slug, both())],
        ...STEPS.map((s): [string, () => Promise<void>] => [`step ${s}`, () => openLaunch(page, f.project.slug, `?env=${f.production.id}`, s)]),
      ];
      let short = 0;
      for (const [name, open] of views) {
        await open();
        await page.waitForTimeout(1500);
        await settled(page);
        const m = await barGap(page);
        if (m.overflows) {
          expect(height, `${name} overflows only at 900`).toBe(900);
          continue;
        }
        short++;
        near(m.gap, 14, 0.5, `${name}: the gap above the bar`);
        // C-4-4 nothing below the bar: the area under it is the page ground
        const below = await page.evaluate((y) => {
          const els = document.elementsFromPoint(700, Math.min(innerHeight - 2, y + 20));
          return els.filter((e) => e.closest('[data-part=customize], [data-testid=launch-home], [data-part=launch-bar]')).length;
        }, m.bottom);
        expect(below, `${name}: no content under the bar`).toBe(0);
      }
      // at 1400 every view is short; at 900 at least start and settings are
      expect(short).toBeGreaterThanOrEqual(height === 1400 ? views.length : 2);
    });
  }

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`R10 C-4-3, C-4-4 long content: the bar rides at the viewport bottom and meets the content at the end (${width} x ${height})`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openHome(page, f.project.slug, both());
      await page.waitForTimeout(1500);
      for (const where of ['top', 'middle', 'end'] as const) {
        await scrollTo(page, where);
        const m = await barGap(page);
        expect(m.overflows).toBe(true);
        near(m.bottom, height, 1, `${where}: the bar at the viewport bottom`);
        if (where === 'end') {
          expect(m.atEnd).toBe(true);
          near(m.gap, 14, 1, 'at the end the bar is 14 px under the content');
          near(m.barBottomInScroller, m.scrollHeight, 1, 'C-4-4 nothing below the bar adds height');
        }
      }
    });
  }

  test('R10 C-4-5 a step change: after the hold the bar moves under the new step; its parts keep their x', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await openLaunch(page, f.project.slug, `?env=${f.production.id}`, 'where');
    await page.waitForTimeout(1200);
    const before = await barParts(page);
    await part(page, 'bar-continue').click();
    await expect(page.getByRole('heading', { name: 'Starting point', level: 2 })).toBeVisible();
    await page.waitForTimeout(1100);
    await settled(page);
    const m = await barGap(page);
    near(m.gap, 14, 0.5, 'bar under the start step');
    const after = await barParts(page);
    for (const p of after.parts) near(p.x, before.parts.find((q) => q.part === p.part)!.x, 1, `x of ${p.part}`);
  });

  test('R10 C-4-6 the preset editor follows its content too (1440 x 1400)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    for (const step of ['where', 'models', 'settings', 'evaluation', 'review']) {
      await page.goto(`/projects/${f.project.slug}/environments/${f.production.id}/default-preset/edit?step=${step}`);
      await expect(page.locator('[data-part=customize][data-mode=editor]')).toBeVisible({ timeout: 25_000 });
      await page.waitForTimeout(1500);
      const m = await barGap(page);
      if (!m.overflows) near(m.gap, 14, 0.5, `editor ${step}`);
      else near(m.bottom, 1400, 1, `editor ${step} overflows: the bar at the bottom`);
    }
  });
});
