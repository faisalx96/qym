/**
 * Cutover: ported from tests/platform/test_dataset_editing_browser.py and
 * test_dataset_import_browser.py (design review C003, C004, C016-C019, C048,
 * C052, C181/C321). The pure rules (slug, encoding detection, JSON aliases,
 * word diff) live in lib/__tests__/cutover-dataset-editing.test.ts; this file
 * drives the real pages and checks the requests they send.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, publishVersion, type SeedItem } from './support';
import { pickSelect, tmpFile } from './ui';

type Api = APIRequestContext;

async function seedDraft(request: Api, prefix: string, items: SeedItem[]) {
  const p = await createProject(request, `Edit ${prefix}`, uniqueSlug(prefix));
  const d = await createDataset(request, p.slug, `Edit DS ${prefix}`);
  const v = await createVersion(request, p.slug, d.slug);
  if (items.length) await bulkItems(request, p.slug, d.slug, v.version, items);
  return { p, d, v };
}

const dsUrl = (p: { slug: string }, d: { slug: string }, tail = '') =>
  `/projects/${p.slug}/datasets/${d.slug}${tail}`;
const panel = (page: Page, label: string) =>
  page.locator('section').filter({ has: page.getByRole('textbox', { name: label, exact: true }) });

/**
 * Records the fields of every FormData the page sends over XHR (Playwright cannot read multipart
 * bodies that carry a file). Call before navigating; read with `upload(page)`.
 */
async function captureUploads(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __uploads: Record<string, string>[] };
    w.__uploads = [];
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      if (body instanceof FormData) {
        const fields: Record<string, string> = {};
        body.forEach((value, key) => {
          fields[key] = typeof value === 'string' ? value : `file:${value.name}`;
        });
        w.__uploads.push(fields);
      }
      return send.call(this, body);
    };
  });
}
/** The fields of the first upload the page has sent (waits for it). */
async function upload(page: Page): Promise<Record<string, string>> {
  await page.waitForFunction(() => (window as unknown as { __uploads: unknown[] }).__uploads.length > 0);
  return page.evaluate(() => (window as unknown as { __uploads: Record<string, string>[] }).__uploads[0]!);
}

function csvText(items: SeedItem[], delimiter: ',' | '\t'): string {
  const cell = (v: unknown) => {
    const s = String(v ?? '');
    return /["\n\r,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = ['item_id', 'input', 'expected_output'] as const;
  return (
    [cols.join(delimiter), ...items.map((i) => cols.map((c) => cell(i[c])).join(delimiter))].join('\n') + '\n'
  );
}

// "السؤال,الإجابة ..." in Windows-1256 (the Arabic Excel export that used to open as mojibake).
const ARABIC_CP1256 = Buffer.from(
  'c7e1d3c4c7e12cc7e1c5ccc7c8c90ae3c720e5ed20dac7d5e3c920c7e1e3e3e1dfc920c7e1dad1c8edc920c7e1d3dae6cfedc9bf2cc7e1d1edc7d60adfe320dacfcf20c3edc7e320c7e1c3d3c8e6dabf2cd3c8dac90a',
  'hex',
);

async function openCatalogWizard(page: Page, slug: string) {
  await gotoApp(page, `/projects/${slug}/datasets`);
  await page.getByTestId('new-dataset').click();
  await page.getByRole('menuitem', { name: /Import CSV/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload dataset' });
  await expect(dialog).toBeVisible();
  return dialog;
}
const next = (dialog: Locator) => dialog.getByTestId('wizard-next');

test.describe('items table and item page editing (C003, C017)', () => {
  test('a draft items table has no inline cell editor', async ({ page, request }) => {
    const { p, d } = await seedDraft(request, 'noinline', [
      { item_id: 'case-1', input: 'q', expected_output: '51', metadata: { topic: 'm' }, labels: ['gold'] },
    ]);
    const patches: string[] = [];
    page.on('request', (r) => r.method() === 'PATCH' && patches.push(r.url()));
    await gotoApp(page, dsUrl(p, d));
    const row = page.locator('[data-item-link="case-1"]').locator('xpath=ancestor::*[@role="row"]');
    await expect(row).toBeVisible();
    // (the index cell is the row link; the previews are plain cells)
    for (const col of ['input', 'expected', 'metadata']) await row.locator(`[data-col="${col}"]`).dblclick();
    await expect(page.getByRole('grid').locator('textarea')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(patches).toEqual([]);
  });

  test('item page Save sends only the edited fields; an untouched value is "unchanged" (CRLF too)', async ({
    page,
    request,
  }) => {
    const { p, d } = await seedDraft(request, 'savemin', [
      {
        item_id: 'case-1',
        input: 'What is 50+1?',
        expected_output: '51',
        metadata: { topic: 'math' },
        labels: ['gold'],
      },
      { item_id: 'case-2', input: 'line 1\r\nline 2', expected_output: 'x' },
    ]);
    await gotoApp(page, dsUrl(p, d, '?v=v1&item=case-1'));
    const save = page.getByTestId('save-item');
    await expect(panel(page, 'Expected output').getByTestId('type-tag')).toHaveText('string');
    await expect(save).toBeDisabled(); // nothing to save
    await page.getByRole('textbox', { name: 'Input', exact: true }).fill('What is 50+2?');
    const patch = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/items/case-1'));
    await save.click();
    const req = await patch;
    expect(new URL(req.url()).pathname).toBe(`/v1/datasets/${d.slug}/versions/v1/items/case-1`);
    // the untouched expected_output ("51" string), metadata and labels are not sent at all
    expect(req.postDataJSON()).toEqual({ input: 'What is 50+2?' });

    // a textarea reads "\r\n" back as "\n": an untouched multiline value is still unchanged
    await gotoApp(page, dsUrl(p, d, '?v=v1&item=case-2'));
    await expect(panel(page, 'Input').getByText('unchanged')).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByRole('textbox', { name: 'Expected output', exact: true }).fill('52');
    const patch2 = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/items/case-2'));
    await save.click();
    expect((await patch2).postDataJSON()).toEqual({ expected_output: '52' });
  });

  test('a string stays a string unless the field is switched to JSON', async ({ page, request }) => {
    const { p, d } = await seedDraft(request, 'strtype', [
      { item_id: 'case-1', input: 'q', expected_output: '51' },
    ]);
    await gotoApp(page, dsUrl(p, d, '?v=v1&item=case-1'));
    const expected = panel(page, 'Expected output');
    await page.getByRole('textbox', { name: 'Expected output', exact: true }).fill('52');
    const first = page.waitForRequest((r) => r.method() === 'PATCH');
    await page.getByTestId('save-item').click();
    expect((await first).postDataJSON()).toEqual({ expected_output: '52' });

    await gotoApp(page, dsUrl(p, d, '?v=v1&item=case-1'));
    await expected.getByRole('radiogroup').getByText('JSON').click();
    await expect(expected.getByTestId('type-tag')).toHaveText('string → number');
    await expect(expected).toContainText('will be saved as number');
    const second = page.waitForRequest((r) => r.method() === 'PATCH');
    await page.getByTestId('save-item').click();
    expect((await second).postDataJSON()).toEqual({ expected_output: 52 });
  });

  test('JSON values stay JSON; invalid JSON cannot be saved', async ({ page, request }) => {
    const { p, d } = await seedDraft(request, 'jsonval', [
      { item_id: 'case-1', input: 'q', expected_output: 7 },
    ]);
    await gotoApp(page, dsUrl(p, d, '?v=v1&item=case-1'));
    const expected = panel(page, 'Expected output');
    const box = page.getByRole('textbox', { name: 'Expected output', exact: true });
    await expect(expected.getByTestId('type-tag')).toHaveText('number');
    await expect(expected.getByRole('radio', { name: 'JSON' })).toBeChecked();
    await box.fill('abc');
    await expect(box).toHaveAttribute('aria-invalid', 'true');
    await expect(expected).toContainText('Not valid JSON');
    await expect(page.getByTestId('save-item')).toBeDisabled();
    await box.fill('8');
    const patch = page.waitForRequest((r) => r.method() === 'PATCH');
    await page.getByTestId('save-item').click();
    expect((await patch).postDataJSON()).toEqual({ expected_output: 8 });
  });
});

test.describe('draft import (C016, C017)', () => {
  for (const format of ['csv', 'tsv', 'jsonl'] as const) {
    for (const count of [3, 125]) {
      test(`${format} with ${count} rows submits every row and keeps the preview to 10`, async ({
        page,
        request,
      }) => {
        const { p, d } = await seedDraft(request, `imp${format}${count}`, []);
        const items: SeedItem[] = Array.from({ length: count }, (_, i) => ({
          item_id: `case-${i}`,
          input: `Question ${i}, "quoted"\tvalue`,
          expected_output: `SELECT "customer_id", 'السعودية' AS region\nFROM customers WHERE id = ${i};`,
        }));
        const contents =
          format === 'jsonl'
            ? items.map((i) => JSON.stringify(i)).join('\n\n')
            : csvText(items, format === 'tsv' ? '\t' : ',');
        await gotoApp(page, dsUrl(p, d));
        await page.getByTestId('import-draft').click();
        const dialog = page.getByRole('dialog', { name: /Import into v1/ });
        await dialog
          .locator('#wizard-file')
          .setInputFiles({ name: `items.${format}`, mimeType: 'text/plain', buffer: Buffer.from(contents) });
        await expect(dialog.getByText('Detected format:')).toContainText(
          format === 'jsonl' ? `${count} records` : `${count} rows`,
        );
        await next(dialog).click();
        if (format !== 'jsonl') await next(dialog).click(); // column mapping
        await expect(dialog.locator('table').last().locator('tbody tr')).toHaveCount(Math.min(count, 10));
        await expect(dialog).toContainText(`preview shows first ${Math.min(count, 10)}`);
        const bulk = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/items:bulk'));
        await next(dialog).click();
        const req = await bulk;
        expect(new URL(req.url()).pathname).toBe(`/v1/datasets/${d.slug}/versions/v1/items:bulk`);
        expect((req.postDataJSON() as { upserts: unknown[] }).upserts).toEqual(items);
        await expect(page.getByText(new RegExp(`${count} items? added`))).toBeVisible();
      });
    }
  }

  test('a JSON array imports every item with the server aliases and names the keys it will not read', async ({
    page,
    request,
  }) => {
    const { p, d } = await seedDraft(request, 'impjson', []);
    await gotoApp(page, dsUrl(p, d));
    await page.getByTestId('import-draft').click();
    const dialog = page.getByRole('dialog', { name: /Import into v1/ });
    const body =
      '[{"id": 1, "input": "q1", "expected": "a1", "extra": true}, {"item_id": "b", "input": {"q": 2}}]';
    await dialog
      .locator('#wizard-file')
      .setInputFiles({ name: 'rows.json', mimeType: 'application/json', buffer: Buffer.from(body) });
    await expect(dialog.getByText('Detected format:')).toContainText('JSON');
    await next(dialog).click();
    await expect(dialog).toContainText('2 records');
    await expect(dialog.getByText(/Not imported: extra/)).toBeVisible();
    const bulk = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/items:bulk'));
    await next(dialog).click();
    expect((await bulk).postDataJSON()).toEqual({
      upserts: [
        { item_id: '1', input: 'q1', expected_output: 'a1' },
        { item_id: 'b', input: { q: 2 } },
      ],
    });
    await expect(page.getByText('2 items added')).toBeVisible();
  });

  test('ids and labels are read like the server, and the bulk API accepts them', async ({
    page,
    request,
  }) => {
    const { p, d } = await seedDraft(request, 'implabels', []);
    await gotoApp(page, dsUrl(p, d));
    await page.getByTestId('import-draft').click();
    const dialog = page.getByRole('dialog', { name: /Import into v1/ });
    const body =
      '{"item_id": " a ", "input": "q1", "labels": "gold, hard"}\n{"id": 0, "input": "q2", "labels": ["x", 3, ""]}\n';
    await dialog
      .locator('#wizard-file')
      .setInputFiles({ name: 'rows.jsonl', mimeType: 'text/plain', buffer: Buffer.from(body) });
    await next(dialog).click();
    const bulk = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/items:bulk'));
    await next(dialog).click();
    expect((await bulk).postDataJSON()).toEqual({
      upserts: [
        { item_id: 'a', input: 'q1', labels: ['gold', 'hard'] },
        { input: 'q2', labels: ['x', '3'] },
      ],
    });
    await expect(page.getByText('2 items added')).toBeVisible();
  });

  test('invalid JSONL lines block Continue and are named with their line numbers', async ({
    page,
    request,
  }) => {
    const { p, d } = await seedDraft(request, 'impbad', []);
    let bulkCalls = 0;
    page.on('request', (r) => r.url().includes('/items:bulk') && (bulkCalls += 1));
    await gotoApp(page, dsUrl(p, d));
    await page.getByTestId('import-draft').click();
    const dialog = page.getByRole('dialog', { name: /Import into v1/ });
    const body = '{"input": "ok"}\n{bad json}\n\n["array"]\n{"input": "fine"}\n';
    await dialog
      .locator('#wizard-file')
      .setInputFiles({ name: 'rows.jsonl', mimeType: 'text/plain', buffer: Buffer.from(body) });
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('Line 2 is not valid JSON');
    await expect(alert).toContainText('Line 4 must be a JSON object');
    await next(dialog).click();
    await expect(dialog.locator('table')).toHaveCount(0); // still on the source step, no preview
    expect(bulkCalls).toBe(0);
  });
});

test.describe('upload wizard validation and requests (C004, C018, C019, C052)', () => {
  test.beforeEach(async ({ page }) => captureUploads(page));

  test('required fields are marked inline, not only in toasts', async ({ page, request }) => {
    const p = await createProject(request, 'Wizard Required', uniqueSlug('wzreq'));
    await createDataset(request, p.slug, 'Seed Req');
    const dialog = await openCatalogWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).clear();
    await next(dialog).click();
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByText('Name is required.')).toBeVisible();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Choose a file.' })).toBeVisible();
  });

  test('the review step lists the columns that will not be imported; unknown columns default to Metadata', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Wizard Review', uniqueSlug('wzrev'));
    await createDataset(request, p.slug, 'Seed Rev');
    const dialog = await openCatalogWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Probe');
    await dialog
      .locator('#wizard-file')
      .setInputFiles(tmpFile('probe.csv', 'input,expected_output,category,difficulty\nq,a,geo,easy\n'));
    await next(dialog).click();
    await expect(dialog.getByRole('button', { name: /Role for column category/ })).toContainText('Metadata');
    await pickSelect(dialog, /Role for column difficulty/, 'Ignore (not imported)');
    await next(dialog).click();
    await expect(dialog.getByText('Not imported: difficulty')).toBeVisible();
    await next(dialog).click();
    const form = await upload(page);
    expect(form).toMatchObject({
      metadata_cols: 'category',
      input_cols: 'input',
      expected_cols: 'expected_output',
      create_only: 'true',
    });
  });

  test('Create dataset sends create_only, shows the slug (Arabic names too) and reports a server clash inline', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Wizard Slug', uniqueSlug('wzslug'));
    await createDataset(request, p.slug, 'Seed Slug');
    await page.route('**/v1/datasets:upload', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: "A dataset named 'x' already exists (slug 'x')." }),
      }),
    );
    const dialog = await openCatalogWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('بيانات التقييم');
    await expect(dialog.getByText('Slug:')).toContainText('بيانات-التقييم');
    await dialog.locator('#wizard-file').setInputFiles(tmpFile('probe.csv', 'input,expected_output\nq,a\n'));
    await next(dialog).click();
    await next(dialog).click();
    await expect(dialog.getByText(/slug بيانات-التقييم/)).toBeVisible();
    await next(dialog).click();
    const form = await upload(page);
    await expect(dialog.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
    expect(form).toMatchObject({
      create_only: 'true',
      name: 'بيانات التقييم',
      publish: 'true',
      set_alias: 'production',
    });
  });

  test('a clashing name offers an explicit new version that stays a draft and leaves production alone', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Wizard Clash2', uniqueSlug('wzcl2'));
    const existing = await createDataset(request, p.slug, 'ragbench-100');
    const v1 = await createVersion(request, p.slug, existing.slug);
    await bulkItems(request, p.slug, existing.slug, v1.version, [
      { item_id: 'a', input: 'q', expected_output: 'a' },
    ]);
    const dialog = await openCatalogWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('RAGBench-100');
    await expect(dialog.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
    await dialog.locator('#wizard-file').setInputFiles(tmpFile('probe.csv', 'input,expected_output\nq,a\n'));
    await next(dialog).click();
    await expect(dialog.getByText('Column mapping')).toHaveCount(0); // blocked on the source step
    await dialog.getByRole('button', { name: 'Upload as a new version of ragbench-100' }).click();
    const versionDialog = page.getByRole('dialog', { name: 'Upload a new version' });
    await next(versionDialog).click();
    await next(versionDialog).click();
    await expect(versionDialog).toContainText('Creates version v2 of "ragbench-100"');
    await expect(versionDialog.getByRole('checkbox', { name: 'Publish immediately' })).not.toBeChecked();
    await expect(versionDialog.getByRole('checkbox', { name: 'Set as production alias' })).toHaveCount(0);
    await next(versionDialog).click();
    const form = await upload(page);
    expect(form.dataset_ref).toBe(existing.id);
    expect(Object.keys(form)).not.toContain('create_only');
    expect(Object.keys(form)).not.toContain('publish');
    expect(Object.keys(form)).not.toContain('set_alias');
    expect(form).toMatchObject({ format: 'csv', encoding: 'utf-8' });
  });

  test('the dataset page menu uploads a file as a new version (draft, production untouched)', async ({
    page,
    request,
  }) => {
    const { p, d, v } = await seedDraft(request, 'menuver', [
      { item_id: 'a', input: 'q', expected_output: 'a' },
    ]);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    const v2 = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v2.version, [
      { item_id: 'b', input: 'q', expected_output: 'a' },
    ]);
    await publishVersion(request, p.slug, d.slug, v2.version, false);
    await gotoApp(page, dsUrl(p, d, '?v=v2'));
    await page.getByTestId('hero-more').click();
    await page.getByRole('menuitem', { name: /Upload file as new version/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload a new version' });
    await dialog.locator('#wizard-file').setInputFiles(tmpFile('probe.csv', 'input,expected_output\nq,a\n'));
    await next(dialog).click();
    await next(dialog).click();
    await expect(dialog).toContainText(`Creates version v3 of "${d.name}"`);
    await expect(dialog.getByRole('checkbox', { name: 'Publish immediately' })).not.toBeChecked();
    await next(dialog).click();
    const form = await upload(page);
    expect(form).toMatchObject({ dataset_ref: d.id, name: d.name });
    for (const key of ['create_only', 'publish', 'set_alias']) expect(Object.keys(form)).not.toContain(key);
    await expect(page.getByText(/Version v3 of .* created/)).toBeVisible();
  });

  test('a user who cannot move production sees the alias checkbox disabled with the rule', async ({
    page,
    request,
  }) => {
    const { p, d, v } = await seedDraft(request, 'prodrule', [
      { item_id: 'a', input: 'q', expected_output: 'a' },
    ]);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    await page.route(new RegExp(`/v1/datasets/${d.slug}\\?`), async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { dataset: { permissions: Record<string, boolean> } };
      body.dataset.permissions.can_set_production = false;
      await route.fulfill({ response: res, json: body });
    });
    await gotoApp(page, dsUrl(p, d));
    await page.getByTestId('hero-more').click();
    await page.getByRole('menuitem', { name: /Upload file as new version/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload a new version' });
    await dialog.locator('#wizard-file').setInputFiles(tmpFile('probe.csv', 'input,expected_output\nq,a\n'));
    await next(dialog).click();
    await next(dialog).click();
    await dialog.getByText('Publish immediately').click();
    await expect(dialog.getByRole('checkbox', { name: 'Publish immediately' })).toBeChecked();
    const production = dialog.getByRole('checkbox', { name: 'Set as production alias' });
    await expect(production).toBeDisabled();
    await expect(production).not.toBeChecked();
    await expect(dialog).toContainText('Only project managers can move the production alias');
  });

  test('a Windows-1256 CSV warns when read as another encoding, and a wrong UTF-8 choice blocks Continue', async ({
    page,
    request,
  }) => {
    const { p, d } = await seedDraft(request, 'enc', []);
    await gotoApp(page, dsUrl(p, d));
    await page.getByTestId('import-draft').click();
    const dialog = page.getByRole('dialog', { name: /Import into v1/ });
    await dialog
      .locator('#wizard-file')
      .setInputFiles({ name: 'arabic.csv', mimeType: 'text/csv', buffer: ARABIC_CP1256 });
    await expect(dialog.getByRole('button', { name: /Encoding/ })).toContainText('Windows-1256');
    await expect(dialog.getByRole('status').filter({ hasText: 'looks garbled' })).toHaveCount(0);
    await next(dialog).click();
    await expect(dialog.getByText('السؤال').first()).toBeVisible();
    await dialog.getByRole('button', { name: /Back/ }).click();

    await pickSelect(dialog, /Encoding/, 'Windows-1252 (Western European)');
    await expect(dialog.getByRole('status').filter({ hasText: 'looks garbled' })).toBeVisible();
    await pickSelect(dialog, /Encoding/, 'UTF-8');
    await expect(dialog.getByRole('alert')).toContainText('not valid UTF-8');
    await next(dialog).click();
    await expect(dialog.getByText('Column mapping')).toHaveCount(0);
  });

  test('a new dataset upload sends the chosen encoding and the Arabic column names', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Wizard Encoding', uniqueSlug('wzencq'));
    await createDataset(request, p.slug, 'Seed Enc');
    const dialog = await openCatalogWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Arabic Excel');
    await dialog
      .locator('#wizard-file')
      .setInputFiles({ name: 'arabic.csv', mimeType: 'text/csv', buffer: ARABIC_CP1256 });
    await next(dialog).click();
    await pickSelect(dialog, /Role for column السؤال/, 'Input');
    await pickSelect(dialog, /Role for column الإجابة/, 'Expected output');
    await next(dialog).click();
    await expect(dialog).toContainText('Windows-1256 (Arabic)');
    await next(dialog).click();
    expect(await upload(page)).toMatchObject({
      encoding: 'windows-1256',
      input_cols: 'السؤال',
      expected_cols: 'الإجابة',
    });
  });

  test('column mapping works from the keyboard; a second Item ID demotes the first to Metadata', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Wizard Keys', uniqueSlug('wzkeys'));
    await createDataset(request, p.slug, 'Seed Keys');
    const dialog = await openCatalogWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Probe');
    await dialog
      .locator('#wizard-file')
      .setInputFiles(tmpFile('probe.csv', 'prompt_text,gold,ref\nq,a,r1\n'));
    await next(dialog).click();
    // nothing is recognised as Input: Continue explains
    await next(dialog).click();
    await expect(dialog.getByText('Choose at least one Input column.')).toBeVisible();
    // choose Input for the first column with the keyboard only
    const first = dialog.getByRole('button', { name: /Role for column prompt_text/ });
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.getByRole('option', { name: 'Input', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(first).toContainText('Input');
    await pickSelect(dialog, /Role for column ref/, 'Item ID');
    await pickSelect(dialog, /Role for column gold/, 'Item ID');
    await expect(dialog.getByRole('button', { name: /Role for column ref/ })).toContainText('Metadata');
    await next(dialog).click();
    await next(dialog).click();
    expect(await upload(page)).toMatchObject({
      input_cols: 'prompt_text',
      id_col: 'gold',
      metadata_cols: 'ref',
    });
  });

  test('the wizard is a labelled modal dialog that keeps focus inside and returns it on Escape', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Wizard Focus', uniqueSlug('wzfoc'));
    await createDataset(request, p.slug, 'Seed Focus');
    await gotoApp(page, `/projects/${p.slug}/datasets`);
    const trigger = page.getByTestId('new-dataset');
    await trigger.click();
    await page.getByRole('menuitem', { name: /Import CSV/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Upload dataset' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'Description' })).toHaveCount(1);
    await expect(dialog.locator('#wizard-file')).toHaveAccessibleName(/File \(CSV, TSV, JSON, or JSONL\)/);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true);
    await page.keyboard.press('Escape'); // no file yet: closes at once
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Escape and Cancel ask before discarding a loaded file; the backdrop never loses work', async ({
    page,
    request,
  }) => {
    const p = await createProject(request, 'Wizard Discard2', uniqueSlug('wzdis2'));
    await createDataset(request, p.slug, 'Seed Discard');
    const dialog = await openCatalogWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Probe');
    await dialog.locator('#wizard-file').setInputFiles(tmpFile('probe.csv', 'question,answer\nq,a\n'));
    await next(dialog).click();
    const confirm = page.getByRole('alertdialog', { name: 'Discard this upload?' });
    await page.keyboard.press('Escape');
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    await page.mouse.click(5, 5); // the backdrop
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Keep editing' }).click();
    // kept: still on the mapping step with the auto-detected input
    await expect(dialog.getByText('Column mapping')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Role for column question/ })).toContainText('Input');
    await page.keyboard.press('Escape');
    await confirm.getByRole('button', { name: 'Discard upload' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('menus and the version switcher from the keyboard (C048)', () => {
  async function twoPublished(request: Api, prefix: string) {
    const { p, d, v } = await seedDraft(request, prefix, [
      { item_id: 'a', input: 'q', expected_output: 'a' },
    ]);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    const v2 = await createVersion(request, p.slug, d.slug);
    await bulkItems(request, p.slug, d.slug, v2.version, [
      { item_id: 'b', input: 'q', expected_output: 'a' },
    ]);
    await publishVersion(request, p.slug, d.slug, v2.version, false);
    await createVersion(request, p.slug, d.slug); // v3 draft
    return { p, d };
  }

  test('the version overflow menu is a keyboard menu and Escape returns focus to its trigger', async ({
    page,
    request,
  }) => {
    const { p, d } = await twoPublished(request, 'menukb');
    await gotoApp(page, dsUrl(p, d, '?v=v2'));
    const trigger = page.getByTestId('hero-more');
    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'More actions' });
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const focused = () =>
      page.evaluate(
        () => `${document.activeElement?.getAttribute('role')}:${document.activeElement?.textContent}`,
      );
    await expect.poll(focused).toBe('menuitem:Name version…');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).toBe('menuitem:Compare…');
    await page.keyboard.press('End');
    await expect.poll(focused).toBe('menuitem:↑ Upload file as new version…');
    await page.keyboard.press('Home');
    await expect.poll(focused).toBe('menuitem:Name version…');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('a dialog opened from a menu returns focus to the menu trigger', async ({ page, request }) => {
    const { p, d } = await twoPublished(request, 'menufocus');
    await gotoApp(page, dsUrl(p, d, '?v=v2'));
    const trigger = page.getByTestId('hero-more');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Upload a new version' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('the version switcher is a listbox with arrow keys and Escape', async ({ page, request }) => {
    const { p, d } = await twoPublished(request, 'switchkb');
    await gotoApp(page, dsUrl(p, d, '?v=v2'));
    const pill = page.getByTestId('version-switcher');
    await pill.focus();
    await page.keyboard.press('Enter');
    const listbox = page.getByRole('listbox', { name: 'Versions' });
    await expect(listbox).toBeVisible();
    await expect(pill).toHaveAttribute('aria-expanded', 'true');
    await expect(listbox.getByRole('option')).toHaveCount(3);
    const active = () => page.evaluate(() => document.activeElement?.textContent ?? '');
    await expect.poll(active).toMatch(/^v2/); // opens on the current version
    await page.keyboard.press('ArrowDown');
    await expect.poll(active).toMatch(/^v1/);
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(pill).toBeFocused();
  });
});

test.describe('lineage, compare and the items table links (C181, C321)', () => {
  test('lineage versions are links and the change log lists changes by time, oldest first', async ({
    page,
    request,
  }) => {
    const { p, d, v } = await seedDraft(request, 'lintime', [
      { item_id: 'a', input: 'q', expected_output: 'a' },
    ]);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    const v2 = await createVersion(request, p.slug, d.slug, { from_version: v.version });
    await gotoApp(page, dsUrl(p, d, '?tab=lineage'));
    await expect(page.locator('[data-version-node=v1]')).toBeVisible();
    const link = page.locator('[data-version-node=v2]').getByRole('link', { name: 'v2', exact: true });
    expect(await link.getAttribute('href')).toMatch(/v=v2/);
    expect(await link.getAttribute('href')).toMatch(/tab=lineage/);
    await expect(page.locator('[data-version-node=v2]')).toContainText('created');
    const log = page.locator('[data-dataset-lineage] ol li');
    await expect(log.first()).toBeVisible();
    const texts = await log.allInnerTexts();
    const created = texts.findIndex((t) => /v1 created/.test(t));
    const published = texts.findIndex((t) => /v1 published/.test(t));
    const forked = texts.findIndex((t) => /v2 created from v1/.test(t));
    expect(created).toBeGreaterThanOrEqual(0);
    expect(created).toBeLessThan(published);
    expect(published).toBeLessThan(forked);
    void v2;
  });

  test('compare pages the rows 50 at a time, shows change times oldest first and keeps the tab in the URL', async ({
    page,
    request,
  }) => {
    const { p, d, v } = await seedDraft(
      request,
      'cmptime',
      Array.from({ length: 60 }, (_, i) => ({
        item_id: `item-${i}`,
        input: `old ${i}`,
        expected_output: 'a',
      })),
    );
    await publishVersion(request, p.slug, d.slug, v.version, true);
    const v2 = await createVersion(request, p.slug, d.slug, { from_version: v.version });
    await bulkItems(request, p.slug, d.slug, v2.version, [
      ...Array.from({ length: 60 }, (_, i) => ({
        item_id: `item-${i}`,
        input: `new ${i}`,
        expected_output: 'a',
      })),
      { item_id: 'added-one', input: 'fresh', expected_output: 'a' },
    ]);
    await publishVersion(request, p.slug, d.slug, v2.version, false);
    await gotoApp(page, dsUrl(p, d, '/compare?base=v1&head=v2'));
    const rows = page.locator('[data-compare-row]');
    await expect(rows).toHaveCount(50);
    const heads = page.locator('[data-compare-row] > button');
    expect(await Promise.all([0, 1, 2, 3].map((i) => heads.nth(i).getAttribute('aria-expanded')))).toEqual([
      'true',
      'true',
      'true',
      'false',
    ]);
    await expect(heads.first()).toContainText(/changed \w{3} \d{1,2}, \d{4}/);
    await expect(page.getByText('Listed in the order the changes happened, oldest first.')).toBeVisible();
    // keyboard: the header is a button that toggles its body
    await heads.nth(3).focus();
    await page.keyboard.press('Enter');
    await expect(heads.nth(3)).toHaveAttribute('aria-expanded', 'true');
    await page.getByTestId('compare-more').click();
    await expect(rows).toHaveCount(60);
    await expect(page.getByText('Showing 60 of 60')).toBeVisible();
    await page.getByRole('tab', { name: /Added/ }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('tab')).toBe('added');
    await expect(page.locator('[data-compare-row=added-one]')).toBeVisible();
    await expect(page.locator('[data-compare-row=added-one]')).toContainText('added');
  });

  test('item rows are links and the previews are not tab stops', async ({ page, request }) => {
    const { p, d, v } = await seedDraft(request, 'rowlinks', [
      { item_id: 'alpha', input: 'question one', expected_output: 'a', metadata: { k: 'v' } },
      { item_id: 'beta', input: 'question two', expected_output: 'b' },
    ]);
    await publishVersion(request, p.slug, d.slug, v.version, true);
    let includeContext = '';
    page.on('request', (r) => {
      if (/\/items\?/.test(r.url()))
        includeContext = new URL(r.url()).searchParams.get('include_context') ?? includeContext;
    });
    await gotoApp(page, dsUrl(p, d));
    const link = page.locator('[data-item-link="alpha"]');
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toContain('item=alpha');
    // one link per row, and no preview cell takes a tab stop
    await expect(page.locator('[data-item-link]')).toHaveCount(2);
    expect(await page.locator('[data-items-tab] [role=gridcell] span[tabindex]').count()).toBe(0);
    expect(includeContext).toBe('false');
    // keyboard activation of the row opens the docked pane; the row link opens the item page
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-item-pane=alpha]')).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/item=alpha/);
    await expect(page.locator('[data-item-page=alpha]')).toBeVisible();
  });

  test('settings offer Delete only to the creator or a manager, with honest copy', async ({
    page,
    request,
  }) => {
    const { p, d } = await seedDraft(request, 'delrule', []);
    await page.route(new RegExp(`/v1/datasets/${d.slug}\\?`), async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { dataset: { permissions: Record<string, boolean> } };
      body.dataset.permissions.can_delete = false;
      await route.fulfill({ response: res, json: body });
    });
    await gotoApp(page, dsUrl(p, d, '?tab=settings'));
    const settings = page.locator('[data-dataset-settings]');
    await expect(settings).toContainText('Deleted datasets');
    await expect(settings).toContainText('restore');
    await expect(settings).not.toContainText('removes all its versions');
    await expect(page.getByTestId('delete-dataset')).toHaveCount(0);
    await expect(settings).toContainText(
      'Only the dataset creator or a project manager can delete a dataset.',
    );
    await page.unroute(new RegExp(`/v1/datasets/${d.slug}\\?`));
    await page.reload();
    await expect(page.getByTestId('delete-dataset')).toBeVisible();
  });
});
