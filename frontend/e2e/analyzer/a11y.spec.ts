/// <reference lib="dom" />
/** Analyzer scenario 14 (keyboard, axe) plus RTL input, the 800x900 viewport and a console-clean happy path. */
import { test, expect, type Page } from '@playwright/test';
import { gotoApp } from '../helpers';
import { axeSeriousViolations, describeViolations } from '../shell/support';
import { analysisUrl, seedAnalyzer, step, toggleBox, trackErrors, waitWorkspace } from './helpers';

async function expectNoSerious(page: Page, label: string): Promise<void> {
  // dialogs fade in: axe must not sample half-transparent text
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const v = await axeSeriousViolations(page);
  expect(v, `${label}\n${describeViolations(v)}`).toEqual([]);
}

/** Runs the stub analysis to completion on the Run step. */
async function analyzeToCompletion(page: Page): Promise<void> {
  await step(page, 'Run').click();
  await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
  await expect(page.getByRole('region', { name: 'Analysis job' })).toContainText('metric analyses succeeded', { timeout: 30_000 });
}

test.describe('axe (14)', () => {
  test('Configure, Preview, Run (with a test result), Review', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await expect(page.getByRole('list', { name: 'Targets' })).toBeVisible();
    await expectNoSerious(page, 'configure');

    // detected variable row + open path picker on Configure
    await page.getByRole('textbox', { name: 'Additional instructions' }).fill('Use {rubric}');
    await page.getByLabel('Detected variables').getByRole('button', { name: /\{rubric\} source/ }).click();
    await page.getByRole('option', { name: 'input', exact: true }).click();
    await expectNoSerious(page, 'configure with a variable');

    await step(page, 'Preview').click();
    await expect(page.getByRole('region', { name: 'Prompt messages' })).toBeVisible();
    await page.getByRole('button', { name: 'Full value' }).nth(3).click();
    await expect(page.getByRole('group', { name: '{rubric} fields' })).toBeVisible();
    await expectNoSerious(page, 'preview');

    await step(page, 'Run').click();
    await page.getByRole('button', { name: /^Test Selected/ }).click();
    await expect(page.getByRole('article', { name: /Test result for item/ })).toBeVisible();
    await expectNoSerious(page, 'run with a test result');

    await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
    await expect(page.getByRole('region', { name: 'Analysis job' })).toContainText('metric analyses succeeded', { timeout: 30_000 });
    await expectNoSerious(page, 'run with the job bar');
    await step(page, 'Review').click();
    await expect(page.getByText('Analysis complete')).toBeVisible();
    await expectNoSerious(page, 'review');
  });

  test('the three guidance tabs, a populated rule editor and the version dialogs', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=categories`);
    await expect(page.getByRole('tabpanel', { name: /^Diagnosis categories/ })).toBeVisible();
    for (const label of ['Guidance', 'Subcategories', 'Examples']) {
      await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
      await expectNoSerious(page, `categories / ${label}`);
    }
    await page.getByRole('tab', { name: /^Production rules/ }).click();
    await expect(page.getByRole('heading', { name: 'Rules in v1' })).toBeVisible();
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Cite the context');
    await page.getByRole('textbox', { name: 'Instruction' }).fill('Say which context lines support the answer.');
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expectNoSerious(page, 'rules');
    await page.getByRole('button', { name: 'Publish' }).click();
    const publish = page.getByRole('dialog', { name: 'Publish v1' });
    await expect(publish).toBeVisible();
    await expectNoSerious(page, 'publish dialog');
    await page.keyboard.press('Escape');
    await expect(publish).toBeHidden();
    await page.getByRole('tab', { name: /^Documents/ }).click();
    await expect(page.getByRole('heading', { name: 'Reference documents' })).toBeVisible();
    await expectNoSerious(page, 'documents (empty)');
    await page.getByTestId('document-input').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('some reference text') });
    await expect(page.getByRole('list', { name: 'Document library' })).toContainText('a.txt');
    await expectNoSerious(page, 'documents (library)');
  });

  test('project landing and the sample picker', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { withRepeat: true });
    await gotoApp(page, `/projects/${seed.slug}/analysis`);
    await expect(page.getByText('Select a run to analyze')).toBeVisible();
    await expectNoSerious(page, 'landing');
    await gotoApp(page, analysisUrl(seed.slug, seed.repeatId!));
    await expect(page.getByText('Choose a sample')).toBeVisible();
    await expectNoSerious(page, 'sample picker');
  });
});

test.describe('keyboard (14)', () => {
  test('Tab reaches the steps with a visible focus ring; Enter activates a step', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    const steps = page.getByRole('list', { name: 'Analysis steps' }).getByRole('button');
    await expect(steps).toHaveCount(4);
    // walk forward from the area switch until the first step takes focus
    await page.getByRole('radiogroup', { name: 'Workspace area' }).getByRole('radio').first().focus();
    let reached = false;
    for (let i = 0; i < 6 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await steps.first().evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Configure step is reachable by Tab').toBe(true);
    const ring = await steps.first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { outline: cs.outlineStyle, width: cs.outlineWidth, shadow: cs.boxShadow, matches: el.matches(':focus-visible') };
    });
    expect(ring.matches).toBe(true);
    expect(ring.outline !== 'none' || ring.shadow !== 'none', JSON.stringify(ring)).toBe(true);

    await page.keyboard.press('Tab');
    await expect(steps.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/step=preview/);
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
    await page.keyboard.press('Tab');
    await expect(steps.nth(2)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/step=run/);
  });

  test('arrow keys move between the guidance tabs; Escape closes dialogs', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=categories`);
    const tabs = page.getByRole('tablist', { name: 'Project guidance' });
    const first = tabs.getByRole('tab', { name: /^Diagnosis categories/ });
    await first.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: /^Production rules/ })).toBeFocused();
    await expect(tabs.getByRole('tab', { name: /^Production rules/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/scope=rules/);
    await page.keyboard.press('End');
    await expect(tabs.getByRole('tab', { name: /^Documents/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.getByRole('tab', { name: /^Production rules/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/scope=categories/);

    // inner vertical category tabs use ArrowDown
    const cats = page.getByRole('tablist', { name: 'Categories' });
    await cats.getByRole('tab').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(cats.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');

    // Escape closes the remove-category confirm without removing anything
    await page.getByRole('button', { name: 'Remove category' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Remove category?' }).or(page.getByRole('dialog', { name: 'Remove category?' }));
    await expect(confirm).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(cats.getByRole('tab')).toHaveCount(9);
  });

  test('Escape closes the human-label confirm and nothing is posted', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await request.post('/api/runs/update_root_cause', {
      data: { run_id: seed.runId, item_id: 'item-1', metric_name: 'exact_match', root_cause_issues: [{ category: 'Wrong Format', subcategory: 'x', finding: 'y' }] },
    });
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await toggleBox(page.getByRole('switch', { name: 'Re-analyze human labels' }));
    await step(page, 'Run').click();
    let posted = 0;
    page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/analysis-jobs') && (posted += 1));
    await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(dialog.getByText('Overwrite human diagnoses?')).toBeVisible();
    await expectNoSerious(page, 'human-label confirm');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(300);
    expect(posted).toBe(0);
    await expect(page.getByRole('button', { name: /^Analyze \d+ items?$/ })).toBeFocused();
  });
});

test.describe('layout', () => {
  test('Arabic item input renders right-to-left', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { withArabic: true });
    await gotoApp(page, analysisUrl(seed.slug, seed.arabicId!));
    await waitWorkspace(page);
    const first = page.getByRole('list', { name: 'Targets' }).getByRole('listitem').first();
    const text = first.locator('[dir="rtl"]', { hasText: 'اعرض' });
    await expect(text).toHaveCount(1);
    await expect(text).toHaveCSS('direction', 'rtl');
    // the preview body keeps dir=auto so the same text reads right-to-left there too
    await step(page, 'Preview').click();
    const body = page.getByRole('region', { name: 'Prompt messages' }).locator('pre').first();
    await expect(body).toHaveAttribute('dir', 'auto');
    await expect(body).toContainText('اعرض');
  });

  test('800x900: no horizontal page scroll on any step or guidance tab', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await page.setViewportSize({ width: 800, height: 900 });
    const overflow = () =>
      page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }));
    const expectFits = async (label: string) => {
      const o = await overflow();
      expect(o.doc, `${label}: documentElement overflows by ${o.doc}px`).toBeLessThanOrEqual(0);
      expect(o.body, `${label}: body overflows by ${o.body}px`).toBeLessThanOrEqual(0);
    };
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await expect(page.getByRole('list', { name: 'Targets' })).toBeVisible();
    await expectFits('configure');
    await page.getByRole('textbox', { name: 'Additional instructions' }).fill('Use {rubric}');
    await expectFits('configure with a variable');
    await step(page, 'Preview').click();
    await expect(page.getByRole('region', { name: 'Prompt messages' })).toBeVisible();
    await expectFits('preview');
    await step(page, 'Run').click();
    await page.getByRole('button', { name: /^Test Selected/ }).click();
    await expect(page.getByRole('article', { name: /Test result for item/ })).toBeVisible();
    await expectFits('run with a result');
    await page.getByRole('button', { name: /^Analyze \d+ items?$/ }).click();
    await expect(page.getByRole('region', { name: 'Analysis job' })).toContainText('metric analyses succeeded', { timeout: 30_000 });
    await expectFits('run with the job bar');
    await step(page, 'Review').click();
    await expect(page.getByText('Analysis complete')).toBeVisible();
    await expectFits('review');
    for (const tab of ['categories', 'rules', 'documents']) {
      await gotoApp(page, `/projects/${seed.slug}/analysis?scope=${tab}`);
      await expect(page.getByRole('tablist', { name: 'Project guidance' })).toBeVisible();
      await page.waitForTimeout(300);
      await expectFits(`guidance ${tab}`);
    }
  });

  test('the happy path logs no console errors or page errors', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { withRepeat: true });
    const t = trackErrors(page);
    await gotoApp(page, analysisUrl(seed.slug, seed.repeatId!));
    await page.getByRole('button', { name: 'Analyze sample 1' }).click();
    await waitWorkspace(page);
    await step(page, 'Preview').click();
    await expect(page.getByRole('region', { name: 'Prompt messages' })).toBeVisible();
    await step(page, 'Run').click();
    await page.getByRole('button', { name: /^Test Selected/ }).click();
    await expect(page.getByRole('article', { name: /Test result for item/ })).toBeVisible();
    await analyzeToCompletion(page);
    await step(page, 'Review').click();
    await expect(page.getByText('Analysis complete')).toBeVisible();
    for (const tab of ['categories', 'rules', 'documents']) {
      await gotoApp(page, `/projects/${seed.slug}/analysis?run=${seed.repeatId}&pass=1&scope=${tab}`);
      await expect(page.getByRole('tablist', { name: 'Project guidance' })).toBeVisible();
      await page.waitForTimeout(400);
    }
    expect(t.errors, t.errors.join('\n')).toEqual([]);
  });
});
