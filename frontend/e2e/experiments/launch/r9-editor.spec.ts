/**
 * Round 9, point 8 (docs/internal/ui-migration/redesign9/experiments.md C-8-*): the default-preset editor is the Customize
 * wizard in editor mode: the same Stepper, the same step panels, the same bar, the same Review step.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { resetFakes, test } from '../support';
import { openLaunch, seedLaunch, toReview, type LaunchFixture } from './launchSupport';
import { bar, box, computed, near, part } from './r9Support';

test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

let f: LaunchFixture;
test.beforeEach(async ({ request }) => {
  await resetFakes(request);
  f = await seedLaunch(request);
});

const editorUrl = (step = 'where') =>
  `/projects/${f.project.slug}/environments/${f.env.id}/default-preset/edit?step=${step}`;
const steps = (page: Page): Locator => page.getByRole('navigation', { name: 'Steps' });

async function open(page: Page, step = 'where'): Promise<void> {
  await page.goto(editorUrl(step));
  await expect(page.locator('[data-part=customize][data-mode=editor]')).toBeVisible({ timeout: 25_000 });
}

const barChrome = (page: Page) =>
  computed(bar(page), [
    'position',
    'background-color',
    'border-top-color',
    'border-top-width',
    'border-top-left-radius',
    'box-shadow',
    'min-height',
  ]);

test.describe('the preset editor is the Customize wizard', () => {
  test('C-8-1 the same Stepper with five segments, no Outline pills', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await expect(steps(page).getByRole('button')).toHaveCount(5);
    const editorBars = await steps(page).locator('[class*=bar], [aria-hidden]').count();
    const geometry = async () => ({
      label: (await computed(steps(page).getByRole('button').first(), ['font-size']))['font-size'],
      step: (await box(steps(page).getByRole('listitem').first())).height,
    });
    const inEditor = await geometry();
    await expect(page.getByRole('link', { name: 'Raw JSON' })).toHaveCount(0);
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    const inLaunch = await geometry();
    expect(inEditor).toEqual(inLaunch);
    expect(editorBars).toBeGreaterThan(0);
  });

  test('C-8-2 the same bar chrome as Customize; Publish v2 is disabled until nothing blocks it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const editor = await barChrome(page);
    near((await box(bar(page))).height, 56, 1, 'bar height');
    // round 10, C-1-1 / C-1-3: five parts; Continue on the editor's first steps, Publish v2 on Review and publish
    await expect(part(page, 'bar-continue')).toHaveText('Continue');
    await expect(part(page, 'bar-launch')).toHaveCount(0);
    await expect(part(page, 'bar-status')).toContainText('0 changes vs v1');
    expect(
      await bar(page).evaluate((n) =>
        Array.from(n.querySelectorAll('[data-part]')).map((e) => e.getAttribute('data-part')),
      ),
    ).toEqual(['bar-skip', 'bar-cancel', 'bar-status', 'bar-back', 'bar-continue']);
    await toReview(page);
    await expect(part(page, 'bar-continue')).toHaveAttribute('data-action', 'publish');
    await expect(part(page, 'bar-continue')).toHaveText('Publish v2');
    await expect(part(page, 'bar-continue')).toBeDisabled();
    await openLaunch(page, f.project.slug, `?env=${f.env.id}`);
    expect(await barChrome(page)).toEqual(editor);
  });

  test('C-8-3 one panel at a time with an h2 and no collapsible section headers', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [step, title] of [
      ['where', 'Environment and dataset'],
      ['models', 'Models'],
      ['settings', 'Environment configurations'],
      ['evaluation', 'Evaluation configurations'],
      ['review', 'Review and publish'],
    ] as const) {
      await open(page, step);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(title);
      await expect(page.locator('[data-part=customize] h3 > button[aria-expanded]')).toHaveCount(0);
    }
  });

  test('C-8-4 the models, settings and evaluation steps hold the same parts in both modes', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const partsOf = () =>
      page
        .locator('[data-part=customize]')
        .evaluate((root) =>
          Array.from(
            new Set(Array.from(root.querySelectorAll('[data-part]')).map((e) => e.getAttribute('data-part'))),
          ).sort(),
        );
    for (const step of ['models', 'settings', 'evaluation'] as const) {
      await open(page, step);
      const editor = await partsOf();
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`, step);
      expect(editor, `${step} parts`).toEqual(await partsOf());
    }
  });

  test('C-8-4 (amended) the controls differ only by the named set a preset cannot hold: settings and evaluation have none, models omit the temporary-model and LLM-group controls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Every control of the step (the bar and the stepper are the same by C-8-1 and C-8-2): its role and accessible name.
    const controlsOf = (): Promise<string[]> =>
      page.locator('[data-part=customize]').evaluate((root) => {
        const out = new Set<string>();
        for (const el of Array.from(
          root.querySelectorAll(
            'button, input, textarea, select, [role=radio], [role=checkbox], [role=switch], [role=combobox], a[href]',
          ),
        )) {
          if (el.closest('[data-part=launch-bar], nav[aria-label=Steps]')) continue;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const label =
            el.getAttribute('aria-label') ||
            (el.getAttribute('aria-labelledby')
              ? document.getElementById(el.getAttribute('aria-labelledby')!.split(' ')[0]!)?.textContent
              : '') ||
            el.getAttribute('placeholder') ||
            (el.textContent ?? '').replace(/\s+/g, ' ').trim();
          out.add(`${el.getAttribute('role') ?? el.tagName.toLowerCase()}: ${label}`);
        }
        return Array.from(out).sort();
      });
    const both: Record<string, { editor: string[]; launch: string[] }> = {};
    for (const step of ['models', 'settings', 'evaluation'] as const) {
      await open(page, step);
      await page.waitForTimeout(600);
      const editor = await controlsOf();
      await openLaunch(page, f.project.slug, `?env=${f.env.id}`, step);
      await page.waitForTimeout(600);
      both[step] = { editor, launch: await controlsOf() };
    }
    for (const step of ['settings', 'evaluation'] as const)
      expect(both[step]!.editor, `${step} controls`).toEqual(both[step]!.launch);
    // Models: the editor's controls are Customize's minus exactly the per-launch ones (a preset holds no secrets and no temporary models)
    const absent = both['models']!.launch.filter((c) => !both['models']!.editor.includes(c));
    expect(
      both['models']!.editor.filter((c) => !both['models']!.launch.includes(c)),
      'the editor adds no control',
    ).toEqual([]);
    expect(absent, 'the per-launch controls a preset cannot hold').toEqual([
      'button: Add LLM endpoint',
      'button: Add models',
      'button: Add temporary model',
      'button: Edit LLM groups',
      'input: New LLM endpoint name',
    ]);
  });

  test('C-8-5 Review and publish: Summary rows, required release notes, Changes and Checks, no aside, at most 1050 px high', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, 'review');
    const rows = await page
      .locator('[data-part=review-kv] [data-row]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-row')));
    expect(rows).toEqual(['env', 'task', 'ds', 'base', 'diff']);
    const notes = page.getByRole('textbox', { name: /Release notes/ });
    await expect(notes).toHaveAttribute('rows', '4');
    await expect(notes).toHaveAttribute('required', '');
    await expect(page.getByText('0 / 5000')).toBeVisible();
    await expect(part(page, 'review-changes')).toBeVisible();
    await expect(part(page, 'review-checks')).toBeVisible();
    await expect(
      page.locator('aside[aria-label="Review"], aside[aria-label="Review and publish"]'),
    ).toHaveCount(0);
    const height = await page.locator('[data-part=customize]').evaluate((el) => {
      let n: HTMLElement | null = el.parentElement;
      while (n && !/(auto|scroll)/.test(getComputedStyle(n).overflowY)) n = n.parentElement;
      return (n ?? document.documentElement).scrollHeight;
    });
    expect(height).toBeLessThanOrEqual(1050 + 120); // the shell header sits above the page: 1050 is the page's own height
  });

  for (const [width, max] of [
    [1440, 900],
    [390, 1300],
  ] as const) {
    test(`C-8-6 step 1 is at most ${max}px high at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page);
      await expect(part(page, 'compared-with')).toBeVisible();
      // amended C-8-6: a preset holds one dataset, so step 1 keeps the single dataset picker (no Datasets card, no Add dataset)
      await expect(page.getByTestId('datasets-fieldset')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Add (another )?dataset/i })).toHaveCount(0);
      const h = await page.locator('[data-part=customize]').evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top =
          (el.parentElement?.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().top ??
          r.top;
        return r.bottom - top;
      });
      expect(h).toBeLessThanOrEqual(max);
    });
  }

  test('C-8-8 the header names the environment and the version the draft is compared with', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Default preset · Alpha');
    await expect(page.getByText(/Compared with: Default preset v1/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the environment' })).toBeVisible();
    // Environment and Task live on step 1; the dataset picker too
    await expect(page.getByRole('region', { name: 'Environment' })).toContainText('Alpha');
  });

  test('?step= works in the editor and an id the editor does not have is step 1', async ({ page }) => {
    await open(page, 'start');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText('Environment and dataset');
  });
});
