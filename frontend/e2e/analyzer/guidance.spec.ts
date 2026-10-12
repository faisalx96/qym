/// <reference lib="dom" />
/** Analyzer scenarios 10-13 and 15: Rules, Documents, Diagnosis, read-only member view, project landing. */
import { test, expect } from '@playwright/test';
import { gotoApp } from '../helpers';
import { analysisUrl, patchJson, seedAnalyzer, step, toggleBox, trackErrors, waitWorkspace } from './helpers';

const guidanceUrl = (slug: string, tab: 'rules' | 'documents' | 'categories') => `/projects/${slug}/analysis?scope=${tab}`;

const isRuleSave = (r: { method(): string; url(): string }) => r.method() === 'PATCH' && /analysis-context$/.test(r.url());

test.describe('Rules tab as manager (10)', () => {
  test('draft -> autosave -> publish live -> new draft -> compare, merge, delete', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    const t = trackErrors(page);
    await gotoApp(page, guidanceUrl(seed.slug, 'rules'));
    await expect(page.getByRole('heading', { name: 'Rules in v1' })).toBeVisible();
    await expect(page.getByText('Editable draft')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled(); // no rules yet

    // edit -> debounced PATCH (~700 ms after the last keystroke)
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('Cite the context');
    let patches = 0;
    page.on('request', (r) => isRuleSave(r) && (patches += 1));
    const instruction = page.getByRole('textbox', { name: 'Instruction' });
    await instruction.fill('Say which context lines support the answer.');
    const typedAt = Date.now();
    const saved = await page.waitForRequest(isRuleSave);
    const waited = Date.now() - typedAt;
    expect(waited).toBeGreaterThanOrEqual(500);
    expect(waited).toBeLessThan(4000);
    expect(JSON.stringify(saved.postDataJSON())).toContain('Cite the context');
    await expect(page.getByText('Draft saved')).toBeVisible();
    expect(patches).toBe(1);

    // publish with "Set as production"
    await page.getByRole('button', { name: 'Publish' }).click();
    const publish = page.getByRole('dialog', { name: 'Publish v1' });
    await expect(publish.getByRole('switch', { name: 'Set as production' })).toBeChecked();
    await publish.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('v1 published and live').first()).toBeVisible();
    const list = page.getByRole('complementary', { name: 'Rule versions' });
    await expect(list.getByText('Live')).toBeVisible();
    await expect(page.getByText('Read-only', { exact: true })).toBeVisible();

    // create a draft from the live version, change the rule
    await page.getByRole('button', { name: 'Create draft', exact: true }).first().click();
    await expect(page.getByText('Draft v2 created from v1').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rules in v2' })).toBeVisible();
    await page.getByRole('button', { name: 'Cite the context', exact: true }).click();
    const edit = page.waitForRequest(isRuleSave);
    await page.getByRole('textbox', { name: 'Instruction' }).fill('Quote the supporting context lines verbatim.');
    await edit;
    await expect(page.getByText('Draft saved')).toBeVisible();

    // compare v2 with v1
    await page.getByRole('button', { name: 'Actions for v2' }).click();
    await page.getByRole('menuitem', { name: 'Compare with…' }).click();
    const compare = page.getByRole('dialog', { name: 'Compare v2' });
    await expect(compare.getByTestId('compare-summary')).toContainText('1 changed');
    await compare.getByText(/Changed: /).click();
    await expect(compare).toContainText('Quote the supporting context lines verbatim.');
    await page.keyboard.press('Escape');
    await expect(compare).toBeHidden();

    // merge preview
    await page.getByRole('button', { name: 'Actions for v2' }).click();
    await page.getByRole('menuitem', { name: 'Merge with…' }).click();
    const merge = page.getByRole('dialog', { name: 'Merge into v2' });
    await merge.getByRole('button', { name: 'Preview merge' }).click();
    await expect(merge.getByTestId('merge-preview')).toBeVisible();
    await expect(merge.getByTestId('merge-preview')).toContainText('conflicts');
    await merge.getByRole('button', { name: 'Cancel' }).click();
    await expect(merge).toBeHidden();

    // delete the draft after a confirm
    await page.getByRole('button', { name: 'Actions for v2' }).click();
    await page.getByRole('menuitem', { name: 'Delete version' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete version?' }).or(page.getByRole('dialog', { name: 'Delete version?' }));
    await expect(confirm).toContainText('v2 is removed from the history');
    await confirm.getByRole('button', { name: 'Delete version' }).click();
    await expect(page.getByText('v2 deleted').first()).toBeVisible();
    await expect(list.getByText('v2')).toHaveCount(0);
    expect(t.errors, t.errors.join('\n')).toEqual([]);
  });

  test('Generate rules: no sources gives an inline reason; an uploaded document lets the stub write rules', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, guidanceUrl(seed.slug, 'rules'));
    await expect(page.getByRole('button', { name: 'Generate rules' })).toBeDisabled();
    await expect(page.getByText(/Rules cannot be generated yet\. This project has neither an enabled project document nor an approved example/)).toBeVisible();

    await page.getByRole('tab', { name: /^Documents/ }).click();
    await page.getByTestId('document-input').setInputFiles({
      name: 'policy.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Answers must cite the supplied context. Never invent table names.'),
    });
    await expect(page.getByRole('list', { name: 'Document library' })).toContainText('policy.txt');
    await page.getByRole('tab', { name: /^Production rules/ }).click();
    await expect(page.getByText('Add documents (1 enabled)')).toBeVisible();
    const generate = page.getByRole('button', { name: 'Generate rules' });
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(page.getByLabel('Rule generation progress')).toBeVisible();
    await expect(page.getByText('Added 1 new rule').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Ground every answer')).toBeVisible();
  });
});

test.describe('Documents (11)', () => {
  test('upload, exclude (PATCH), delete after a confirm (DELETE)', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    const t = trackErrors(page);
    await gotoApp(page, guidanceUrl(seed.slug, 'documents'));
    await expect(page.getByText('No project documents yet')).toBeVisible();
    const upload = page.waitForRequest((r) => r.method() === 'POST' && /analysis-documents$/.test(r.url()));
    await page.getByTestId('document-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello analyzer, short notes') });
    await upload;
    const library = page.getByRole('list', { name: 'Document library' });
    await expect(library).toContainText('notes.txt');
    await expect(page.getByText('Added 1 of 1 document.')).toBeVisible();
    await expect(page.getByText('1 of 1 enabled')).toBeVisible();

    const patch = page.waitForRequest((r) => r.method() === 'PATCH' && /analysis-documents\//.test(r.url()));
    await toggleBox(page.getByRole('switch', { name: 'notes.txt: included' }));
    expect(JSON.stringify((await patch).postDataJSON())).toContain('false');
    await expect(library.getByText('Excluded')).toBeVisible();
    await expect(page.getByText('0 of 1 enabled')).toBeVisible();

    await page.getByRole('button', { name: 'Delete notes.txt' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete document?' }).or(page.getByRole('dialog', { name: 'Delete document?' }));
    const del = page.waitForRequest((r) => r.method() === 'DELETE' && /analysis-documents\//.test(r.url()));
    await confirm.getByRole('button', { name: 'Delete document' }).click();
    await del;
    await expect(page.getByText('Document deleted').first()).toBeVisible();
    await expect(page.getByText('No project documents yet')).toBeVisible();
    expect(t.errors, t.errors.join('\n')).toEqual([]);
  });

  test('a document above 40,000 characters asks first, then re-uploads with large_document_action=full', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, guidanceUrl(seed.slug, 'documents'));
    // multipart (File) bodies are not exposed by Playwright: record the form field in the page instead
    await page.addInitScript(() => {
      const w = window as unknown as { __uploads: string[] };
      w.__uploads = [];
      const original = window.fetch;
      window.fetch = (input, init) => {
        if (init?.body instanceof FormData && init.method === 'POST') w.__uploads.push(String(init.body.get('large_document_action')));
        return original(input, init);
      };
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Reference documents' })).toBeVisible();
    const uploads = () => page.evaluate(() => (window as unknown as { __uploads: string[] }).__uploads);
    await page.getByTestId('document-input').setInputFiles({
      name: 'big.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(('The analyzer reads every line of this long reference. ').repeat(900)),
    });
    const dialog = page.getByRole('alertdialog', { name: 'Send the full document?' }).or(page.getByRole('dialog', { name: 'Send the full document?' }));
    await expect(dialog).toContainText('big.txt has');
    await expect(dialog).toContainText('characters');
    await dialog.getByRole('button', { name: 'Upload in full' }).click();
    await expect(page.getByRole('list', { name: 'Document library' })).toContainText('big.txt');
    expect(await uploads()).toEqual(['ask', 'full']);

    // declining keeps the library unchanged
    await page.getByTestId('document-input').setInputFiles({
      name: 'big2.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(('Another long reference document with plenty of words. ').repeat(900)),
    });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByText('No documents were added.')).toBeVisible();
    expect(await uploads()).toEqual(['ask', 'full', 'ask']);
    await expect(page.getByRole('list', { name: 'Document library' })).not.toContainText('big2.txt');
  });
});

test.describe('Diagnosis (12)', () => {
  test('a category needs a taxonomy; saving sends base_revision; new categories are marked Needs examples', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, guidanceUrl(seed.slug, 'categories'));
    await expect(page.getByRole('tab', { name: /^Hallucination Needs examples/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add category' }).click();
    await page.getByRole('textbox', { name: 'New category name' }).fill('Brand Voice');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('tab', { name: /^Brand Voice Needs examples/ })).toBeVisible();
    await expect(page.getByTestId('catalog-save-state')).toHaveText('Unsaved changes');

    let puts = 0;
    page.on('request', (r) => r.method() === 'PUT' && /analysis-category-catalog/.test(r.url()) && (puts += 1));
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('catalog-save-state')).toHaveText('Taxonomy required');
    await expect(page.getByText('Add both Description and Use when for: Brand Voice.')).toBeVisible();
    await expect(page.getByText('Description is required.')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Brand Voice.*Incomplete/ })).toBeVisible();
    expect(puts).toBe(0);

    await page.getByRole('textbox', { name: /^Description/ }).fill('Tone and wording that break the brand style guide.');
    await page.getByRole('textbox', { name: /^Use when/ }).fill('The answer is right but written off-brand.');
    const put = page.waitForRequest((r) => r.method() === 'PUT' && /analysis-category-catalog/.test(r.url()));
    await page.getByRole('button', { name: 'Save changes' }).click();
    const body = (await put).postDataJSON() as { base_revision?: number; categories: Array<{ category?: string; name?: string }> };
    expect('base_revision' in body).toBe(true);
    expect(JSON.stringify(body)).toContain('Brand Voice');
    await expect(page.getByText('Categories saved').first()).toBeVisible();
    await expect(page.getByTestId('catalog-save-state')).toHaveText('Saved');
    await expect(page.getByRole('tab', { name: /^Brand Voice Needs examples/ })).toBeVisible();
  });

  test('409 catalog_version_conflict keeps the edits; Overwrite resends with the new revision; Reload latest drops them', async ({
    page,
    request,
  }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, guidanceUrl(seed.slug, 'categories'));
    let call = 0;
    const bodies: Array<{ base_revision?: number }> = [];
    await page.route(/analysis-category-catalog$/, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      bodies.push(route.request().postDataJSON() as { base_revision?: number });
      call += 1;
      if (call === 2) return route.fulfill({ json: { catalog: { version: 100, categories: [] }, created: true } });
      if (call === 1 || call === 3)
        return route.fulfill({
          status: 409,
          json: { detail: { code: 'catalog_version_conflict', message: 'The catalog changed.', current_catalog: { version: 99, categories: [] } } },
        });
      return route.continue();
    });
    await page.getByRole('button', { name: 'Add category' }).click();
    await page.getByRole('textbox', { name: 'New category name' }).fill('Brand Voice');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: /^Description/ }).fill('Tone and wording.');
    await page.getByRole('textbox', { name: /^Use when/ }).fill('Off-brand wording.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'The catalog changed while you were editing' });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('Someone saved revision 99.');
    await expect(page.getByTestId('catalog-save-state')).toHaveText('Conflict');
    // edits are kept
    await expect(page.getByRole('textbox', { name: /^Description/ })).toHaveValue('Tone and wording.');
    await expect(page.getByRole('tab', { name: /^Brand Voice/ })).toBeVisible();

    // Overwrite -> second PUT uses the new revision (real server accepts a stale-looking revision only if it matches; the route lets it through)
    await alert.getByRole('button', { name: 'Overwrite with my edits' }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]?.base_revision).toBe(99);
    await expect(page.getByTestId('catalog-save-state')).not.toHaveText('Conflict', { timeout: 15_000 });

    // second conflict, then Reload latest discards the edits
    await page.getByRole('button', { name: 'Add category' }).click();
    await page.getByRole('textbox', { name: 'New category name' }).fill('Tone Drift');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('textbox', { name: /^Description/ }).fill('Drifts in tone.');
    await page.getByRole('textbox', { name: /^Use when/ }).fill('The tone changes mid answer.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Reload latest' }).click();
    await expect(alert).toBeHidden();
    await expect(page.getByRole('tab', { name: /^Tone Drift/ })).toHaveCount(0);
    await expect(page.getByTestId('catalog-save-state')).toHaveText('Saved');
  });
});

test.describe('read-only view (13)', () => {
  test('without manage rights: banners, no dropzone, readonly inputs, Save / Publish unavailable', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    // The platform grants the flags per project role; simulate a MEMBER by answering the config without them.
    await patchJson(page, /\/analysis-config$/, (c) => ({
      ...c,
      can_manage_analysis_rules: false,
      can_manage_category_catalog: false,
      can_operate_analyzer: false,
    }));
    await patchJson(page, /analysis-rule-versions\?/, (v) => ({ ...v, can_activate: false, can_delete: false }));

    await gotoApp(page, guidanceUrl(seed.slug, 'categories'));
    await expect(page.getByText('Project manager access is required to edit categories.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add category' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: /^Description/ })).toHaveAttribute('readonly', '');
    await expect(page.getByRole('textbox', { name: /^Use when/ })).toHaveAttribute('readonly', '');

    await page.getByRole('tab', { name: /^Production rules/ }).click();
    await expect(page.getByText('Draft (read-only)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create draft', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add rule' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate rules' })).toBeDisabled();

    await page.getByRole('tab', { name: /^Documents/ }).click();
    await expect(page.getByText('Only project managers can add, remove or exclude documents.')).toBeVisible();
    await expect(page.getByTestId('document-input')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose files' })).toHaveCount(0);

    // the run workspace explains that running needs member access and disables Test / Analyze
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await expect(page.getByText('You can read this workspace, but running analyses needs project member access.')).toBeVisible();
    await step(page, 'Run').click();
    await expect(page.getByRole('button', { name: /^Analyze \d+ items?$/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Test Selected/ })).toBeDisabled();
  });

  test('no LLM connection: banner and disabled Test / Analyze; Preview still works', async ({ page, request }) => {
    const seed = await seedAnalyzer(request, { model: '' });
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await expect(page.getByText(/No LLM connection is set up for this project/)).toBeVisible();
    await step(page, 'Preview').click();
    await expect(page.getByRole('region', { name: 'Prompt messages' })).toBeVisible();
    await step(page, 'Run').click();
    await expect(page.getByRole('button', { name: /^Analyze \d+ items?$/ })).toBeDisabled();
  });
});

test.describe('project scope (15)', () => {
  test('without ?run: landing, links, guidance tabs, scope in the URL', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, `/projects/${seed.slug}/analysis`);
    await expect(page.getByText('Select a run to analyze')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Runs' })).toHaveAttribute('href', new RegExp(`/projects/${seed.slug}$`));
    await page.getByRole('button', { name: 'Open project guidance' }).click();
    await expect(page).toHaveURL(/scope=categories/);
    const tabs = page.getByRole('tablist', { name: 'Project guidance' });
    await expect(tabs.getByRole('tab', { name: /^Diagnosis categories/ })).toHaveAttribute('aria-selected', 'true');
    await tabs.getByRole('tab', { name: /^Production rules/ }).click();
    await expect(page).toHaveURL(/scope=rules/);
    await expect(page.getByRole('heading', { name: 'Rules in v1' })).toBeVisible();
    await tabs.getByRole('tab', { name: /^Documents/ }).click();
    await expect(page).toHaveURL(/scope=documents/);
    await expect(page.getByRole('heading', { name: 'Reference documents' })).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Workspace area' }).getByText('Analyze run').click();
    await expect(page.getByText('Select a run to analyze')).toBeVisible();
    // legacy scope aliases
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=diagnosis`);
    await expect(page.getByRole('tab', { name: /^Diagnosis categories/ })).toHaveAttribute('aria-selected', 'true');
    await gotoApp(page, `/projects/${seed.slug}/analysis?scope=project`);
    await expect(page.getByRole('tab', { name: /^Production rules/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('the guidance area is reachable from a run workspace and keeps the run in the URL', async ({ page, request }) => {
    const seed = await seedAnalyzer(request);
    await gotoApp(page, analysisUrl(seed.slug, seed.runId));
    await waitWorkspace(page);
    await page.getByRole('radiogroup', { name: 'Workspace area' }).getByText('Project guidance').click();
    await expect(page).toHaveURL(new RegExp(`run=${seed.runId}`));
    await expect(page).toHaveURL(/scope=categories/);
    await expect(page.getByRole('tab', { name: /^Production rules/ })).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Workspace area' }).getByText('Analyze run').click();
    await waitWorkspace(page);
  });
});

