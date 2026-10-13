/// <reference lib="dom" />
/** Analyzer scenarios 1-5: open, sample picker, metric chips, prompt preview, variable mapping. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import {
  analysisUrl,
  analyzeButton,
  openPreview,
  previewDrawer,
  rail,
  seedAnalyzer,
  toggleBox,
  trackErrors,
  waitWorkspace,
} from './helpers';

test.describe('open the workspace (1)', () => {
  test('single-sample run: one page with Setup, Targets, Results and the action rail', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    const t = trackErrors(page);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    // no wizard chrome: no stepper, no segmented switch, no Back / Next footer
    await expect(page.getByRole('list', { name: 'Analysis steps' })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Workspace area' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Next:/ })).toHaveCount(0);
    for (const name of ['Setup', 'Targets', 'Results'])
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Analyze run/ })).toHaveAttribute('aria-selected', 'true');
    // the one accent button of the idle state carries the target count; the URL keeps the run
    await expect(analyzeButton(page)).toHaveText('Analyze 4 items');
    await expect(analyzeButton(page)).toBeEnabled();
    await expect(rail(page).getByRole('button', { name: /^Test selected/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`run=${seed.runId}`));
    expect(t.errors, t.errors.join('\n')).toEqual([]);
  });

  test('legacy ?step= links: preview opens the drawer, run scrolls to Results, the param is dropped', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId, '&step=preview'));
    await expect(previewDrawer(page)).toBeVisible();
    await expect(page).toHaveURL(/preview=1/);
    await expect(page).not.toHaveURL(/step=/);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId, '&step=run'));
    await waitWorkspace(page);
    await expect(page).not.toHaveURL(/step=/);
    await expect(previewDrawer(page)).toHaveCount(0);
    // ?preview=1 is a deep link too
    await gotoApp(page, analysisUrl(seed.slug, seed.runId, '&preview=1'));
    await expect(previewDrawer(page)).toBeVisible();
  });

  test('legacy URLs land on /analysis?run=<id> and keep pass / metric', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/run/${seed.runId}/analyzer`);
    await expect(page).toHaveURL(new RegExp(`/projects/${seed.slug}/analysis\\?run=${seed.runId}`));
    await waitWorkspace(page);

    await gotoApp(page, `/projects/${seed.slug}/runs/${seed.runId}/analyzer`);
    await expect(page).toHaveURL(new RegExp(`/projects/${seed.slug}/analysis\\?run=${seed.runId}`));
    await waitWorkspace(page);

    await gotoApp(
      page,
      `/projects/${seed.slug}/runs/${seed.runId}/analyzer?pass=1&metric=execution_accuracy`,
    );
    await expect(page).toHaveURL(new RegExp(`/analysis\\?.*run=${seed.runId}`));
    await expect(page).toHaveURL(/pass=1/);
    await expect(page).toHaveURL(/metric=execution_accuracy/);
    await waitWorkspace(page);
  });
});

test.describe('sample picker (2)', () => {
  test('repeat run without pass: pick a sample, URL gains pass, Analyze sends pass_number', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request, { withRepeat: true });
    await gotoApp(page, analysisUrl(seed.slug, seed.repeatId!));
    await expect(page.getByText('Choose a sample')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Samples' }).getByRole('listitem')).toHaveCount(2);
    await page.getByRole('button', { name: 'Analyze sample 2' }).click();
    await expect(page).toHaveURL(/pass=2/);
    await waitWorkspace(page);
    const analyze = page.waitForRequest((r) => r.url().includes('/analysis-jobs') && r.method() === 'POST');
    await analyzeButton(page).click();
    const body = (await analyze).postDataJSON() as { pass_number?: number };
    expect(body.pass_number).toBe(2);
  });

  test('?pass= given: workspace loads straight away and the Sample select is present', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request, { withRepeat: true });
    await gotoApp(page, analysisUrl(seed.slug, seed.repeatId!, '&pass=1'));
    await waitWorkspace(page);
    await expect(page.getByRole('button', { name: /Sample 1 \(4\/4\)/ })).toBeVisible();
  });
});

test.describe('metric chips (3)', () => {
  test('toggle off updates the target count and note; Clear shows the empty reason; ?metric= preselects', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    const metrics = page.getByRole('group', { name: 'Metrics to analyze' });
    await expect(analyzeButton(page)).toHaveText('Analyze 4 items');
    await expect(page.getByText('2 of 2 metrics selected')).toBeVisible();
    await metrics.getByRole('button', { name: 'exact_match' }).click();
    await expect(metrics.getByRole('button', { name: 'exact_match' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(analyzeButton(page)).toHaveText('Analyze 2 items');
    await expect(page.getByText('1 of 2 metrics selected')).toBeVisible();
    await metrics.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByText('Select at least one metric').first()).toBeVisible();
    await expect(analyzeButton(page)).toBeDisabled();
    await metrics.getByRole('button', { name: 'Select all' }).click();
    await expect(analyzeButton(page)).toHaveText('Analyze 4 items');

    await gotoApp(page, analysisUrl(seed.slug, seed.runId, '&metric=execution_accuracy'));
    await waitWorkspace(page);
    const m2 = page.getByRole('group', { name: 'Metrics to analyze' });
    await expect(m2.getByRole('button', { name: 'execution_accuracy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(m2.getByRole('button', { name: 'exact_match' })).toHaveAttribute('aria-pressed', 'false');
    await expect(analyzeButton(page)).toHaveText('Analyze 2 items');
  });
});

test.describe('prompt preview (4)', () => {
  test('selecting a target fires one preview request after the debounce; copy puts the preview on the clipboard', async ({
    page,
    request,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await openPreview(page);
    const drawer = previewDrawer(page);
    const hits: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/analyze-preview')) hits.push(r.postData() ?? '');
    });
    const next = page.waitForRequest((r) => r.url().includes('/analyze-preview'));
    // choose another target of another item through the Previewed target select
    await drawer.getByRole('button', { name: /Previewed target/ }).click();
    await page.getByRole('option', { name: /item-3 · exact_match/ }).click();
    const req = await next;
    expect((req.postDataJSON() as { item_id: string }).item_id).toBe('item-3');
    await expect(drawer.getByRole('region', { name: 'Prompt messages' })).toContainText('q 3');
    await page.waitForTimeout(900); // debounce window + settle: nothing more may follow
    expect(hits.length).toBe(1);

    await drawer.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(drawer.getByRole('button', { name: 'Copied' }).first()).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    const shown = await drawer.getByRole('region', { name: 'Prompt messages' }).locator('pre').allInnerTexts();
    expect(clip).toContain('[system]');
    for (const part of shown) expect(clip).toContain(part.trim().slice(0, 40));
    // Escape closes the drawer and focus returns to the rail button
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/preview=1/);
    await expect(rail(page).getByRole('button', { name: /^Prompt preview/ })).toBeFocused();
  });

  test('a target row can open the preview for itself; the rail shows the character count', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await page.getByRole('button', { name: 'Preview prompt of exact_match on item-3' }).click();
    const drawer = previewDrawer(page);
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('region', { name: 'Prompt messages' })).toContainText('q 3');
    await expect(drawer.getByRole('switch', { name: 'Production rules' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(rail(page).getByRole('button', { name: /^Prompt preview · [\d,]+ chars$/ })).toBeVisible();
  });

  test('a target chip selects the previewed target', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    const chip = page.getByRole('button', { name: /exact_match 0.00, preview target of item-2/ });
    const preview = page.waitForRequest(
      (r) =>
        r.url().includes('/analyze-preview') &&
        (r.postDataJSON() as { item_id: string }).item_id === 'item-2',
    );
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await preview;
  });
});

test.describe('variable mapping (5)', () => {
  test('{rubric} adds a variable row; input source shows a JSON path tree; unchecking paths changes the preview config', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await page.getByRole('textbox', { name: 'Additional instructions' }).fill('Judge against {rubric} only.');
    const vars = page.getByLabel('Detected variables');
    await expect(vars.getByText('{rubric}').first()).toBeVisible();
    // choose source `input`
    await vars.getByRole('button', { name: /\{rubric\} source/ }).click();
    await page.getByRole('option', { name: 'input', exact: true }).click();
    // the {rubric} row sits by the instructions; open its picker
    await vars.getByRole('button', { name: 'Full value' }).click();
    const picker = page.getByRole('group', { name: '{rubric} fields' });
    await expect(picker.getByRole('checkbox', { name: /question/ })).toBeVisible();
    await expect(picker.getByRole('checkbox', { name: /^db/ })).toBeVisible();
    await expect(picker.getByRole('checkbox', { name: /group · 3/ })).toBeVisible(); // nested group renders as a tree
    // with the full value the mapping is the whole field; unchecking a leaf narrows it to the other paths
    await toggleBox(picker.getByRole('checkbox', { name: 'Use full value' }));
    const narrowed = page.waitForRequest((r) => {
      if (!r.url().includes('/analyze-preview')) return false;
      const m = (r.postDataJSON() as { config: { custom_variable_mapping?: Record<string, unknown> } }).config
        .custom_variable_mapping;
      return Array.isArray(m?.rubric);
    });
    await toggleBox(picker.getByRole('checkbox', { name: /^question$/ }));
    const sent2 = (await narrowed).postDataJSON() as {
      config: { custom_variable_mapping: Record<string, string[]> };
    };
    expect(sent2.config.custom_variable_mapping.rubric.join('|')).not.toContain('question');
    expect(sent2.config.custom_variable_mapping.rubric.length).toBeGreaterThan(0);
    await expect(vars.getByRole('button', { name: /^\d+ fields?$/ })).toBeVisible();

    // the Input mapping disclosure holds the standard rows; changing one (Input -> output) (Input -> output) sends field_mapping
    const std = page.waitForRequest(
      (r) =>
        r.url().includes('/analyze-preview') &&
        (r.postDataJSON() as { config: { field_mapping?: Record<string, string> } }).config.field_mapping
          ?.input !== undefined,
    );
    const mapping = page.getByRole('button', { name: /^Input mapping/ });
    await expect(mapping).toHaveAttribute('aria-expanded', 'false');
    await mapping.click();
    await page.getByRole('button', { name: /Input source/ }).click();
    await page.getByRole('option', { name: 'output', exact: true }).click();
    const sent = (await std).postDataJSON() as { config: { field_mapping: Record<string, string> } };
    expect(sent.config.field_mapping.input).toBe('output');
  });
});
