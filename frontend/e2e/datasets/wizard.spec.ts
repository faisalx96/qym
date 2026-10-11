/**
 * Brief 07 §2.2 upload wizard: UTF-8 CSV auto-mapping, Windows-1256 detection and
 * switching, JSONL line errors, name clash, discard confirm.
 */
import { test, expect, type Page } from '@playwright/test';
import { createProject, gotoApp, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, sampleItems } from './support';
import { pickSelect, tmpFile } from './ui';

// Windows-1256 code points for the Arabic letters used below.
const CP1256: Record<string, number> = {
  ا: 0xc7, ب: 0xc8, ت: 0xca, ج: 0xcc, ح: 0xcd, ر: 0xd1, ك: 0xdf, ل: 0xe1, م: 0xe3, ي: 0xed, ن: 0xe4, ع: 0xda, س: 0xd3, ة: 0xc9, ف: 0xdd, ي_: 0xed,
};
function cp1256(text: string): Buffer {
  return Buffer.from([...text].map((ch) => (ch in CP1256 ? (CP1256[ch] as number) : ch.charCodeAt(0))));
}

async function openNewWizard(page: Page, slug: string) {
  await gotoApp(page, `/projects/${slug}/datasets`);
  await page.getByTestId('new-dataset').click();
  await page.getByRole('menuitem', { name: /Import CSV/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload dataset' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('upload wizard', () => {
  test('UTF-8 CSV: auto-mapped columns, preview, publish immediately creates the dataset', async ({ page, request }) => {
    const p = await createProject(request, 'Wizard Csv', uniqueSlug('wzcsv'));
    await createDataset(request, p.slug, 'Seed One'); // makes the toolbar menu available
    const csv = tmpFile('qa.csv', 'question,answer,topic\nWhat is 2+2?,4,math\nCapital of France?,Paris,geo\nمن أنت؟,مساعد,arabic\n');
    const dialog = await openNewWizard(page, p.slug);
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toBeFocused();
    await dialog.locator('#wizard-file').setInputFiles(csv);
    await expect(dialog.getByRole('textbox', { name: /^Name/ })).toHaveValue(/qa$/);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Wizard Imported');
    await expect(dialog.getByText('Detected format:')).toContainText('CSV');
    await expect(dialog.getByText('Detected format:')).toContainText('3 rows');
    await dialog.getByTestId('wizard-next').click();

    // step 2: mapping auto-detected from the header names
    await expect(dialog.getByText('Column mapping')).toBeVisible();
    await expect(dialog.getByText('Input: question · Expected: answer · Item ID: generated · 1 metadata column')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Role for column question/ })).toContainText('Input');
    await expect(dialog.getByRole('button', { name: /Role for column answer/ })).toContainText('Expected output');
    await expect(dialog.getByRole('button', { name: /Role for column topic/ })).toContainText('Metadata');
    // changing a role updates the summary
    await pickSelect(dialog, /Role for column topic/, 'Ignore (not imported)');
    await expect(dialog.getByText('0 metadata columns')).toBeVisible();
    await dialog.getByTestId('wizard-next').click();

    // step 3: review
    await expect(dialog.getByText('Not imported: topic')).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Publish immediately' })).toBeChecked();
    await expect(dialog.getByText(/Creates a new dataset "Wizard Imported"/)).toBeVisible();
    await expect(dialog.locator('table').last()).toContainText('What is 2+2?');
    await dialog.getByTestId('wizard-next').click(); // Create dataset
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(/Dataset "Wizard Imported" created · 3 items/)).toBeVisible();
    await expect(page.locator('[data-dataset-card=wizard-imported]')).toContainText('3');
  });

  test('required Input column: clearing it blocks Continue on the mapping step', async ({ page, request }) => {
    const p = await createProject(request, 'Wizard Map', uniqueSlug('wzmap'));
    await createDataset(request, p.slug, 'Seed Two');
    const csv = tmpFile('m.csv', 'question,answer\nq1,a1\nq2,a2\n');
    const dialog = await openNewWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Map Test');
    await dialog.locator('#wizard-file').setInputFiles(csv);
    await dialog.getByTestId('wizard-next').click();
    await pickSelect(dialog, /Role for column question/, 'Ignore (not imported)');
    await dialog.getByTestId('wizard-next').click();
    await expect(dialog.getByText('Choose at least one Input column.')).toBeVisible();
    await expect(dialog.getByText('Column mapping')).toBeVisible();
  });

  test('Windows-1256 CSV: encoding detected, shown as detected, switchable and restorable', async ({ page, request }) => {
    const p = await createProject(request, 'Wizard Enc', uniqueSlug('wzenc'));
    await createDataset(request, p.slug, 'Seed Three');
    const body = cp1256('input,output\nمرحبا بكم,كتاب جميل\nمرحبا بكم,كتاب جميل\nمرحبا بكم,كتاب جميل\nمرحبا بكم,كتاب جميل\n');
    const file = tmpFile('arabic.csv', body);
    const dialog = await openNewWizard(page, p.slug);
    await dialog.locator('#wizard-file').setInputFiles(file);
    const enc = dialog.getByRole('button', { name: /Encoding/ });
    await expect(enc).toContainText('Windows-1256');
    await enc.click();
    await expect(page.getByRole('option', { name: /Windows-1256.*detected/ })).toBeVisible();
    await page.keyboard.press('Escape');

    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Arabic Win');
    await dialog.getByTestId('wizard-next').click();
    await expect(dialog.locator('td').filter({ hasText: 'مرحبا بكم' }).first()).toBeVisible();
    await dialog.getByRole('button', { name: /Back/ }).click();

    await pickSelect(dialog, /Encoding/, 'Windows-1252 (Western European)');
    await expect(dialog.getByRole('button', { name: /Encoding/ })).toContainText('Windows-1252');
    await dialog.getByTestId('wizard-next').click();
    await expect(dialog.locator('td').filter({ hasText: 'مرحبا بكم' })).toHaveCount(0);
    await dialog.getByRole('button', { name: /Back/ }).click();

    await pickSelect(dialog, /Encoding/, /Windows-1256/);
    await dialog.getByTestId('wizard-next').click();
    await expect(dialog.locator('td').filter({ hasText: 'مرحبا بكم' }).first()).toBeVisible();
  });

  test('JSONL with an invalid line shows "Line 3 is not valid JSON" and blocks Continue', async ({ page, request }) => {
    const p = await createProject(request, 'Wizard Jsonl', uniqueSlug('wzjl'));
    await createDataset(request, p.slug, 'Seed Four');
    const file = tmpFile('bad.jsonl', '{"input":"a","expected_output":"b"}\n{"input":"c"}\n{not json}\n');
    const dialog = await openNewWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Bad Lines');
    await dialog.locator('#wizard-file').setInputFiles(file);
    await expect(dialog.getByRole('alert').filter({ hasText: 'Line 3 is not valid JSON' })).toBeVisible();
    await dialog.getByTestId('wizard-next').click();
    // still on step 1: the file step, no mapping/review
    await expect(dialog.getByText('Line 3 is not valid JSON').first()).toBeVisible();
    await expect(dialog.getByText('Column mapping')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /Back/ })).toHaveCount(0);
  });

  test('valid JSONL skips the mapping step and imports', async ({ page, request }) => {
    const p = await createProject(request, 'Wizard Jsonl Ok', uniqueSlug('wzjlok'));
    await createDataset(request, p.slug, 'Seed Five');
    const file = tmpFile('ok.jsonl', '{"input":"a","expected_output":"b","extra":1}\n{"input":"c"}\n');
    const dialog = await openNewWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Good Lines');
    await dialog.locator('#wizard-file').setInputFiles(file);
    await expect(dialog.getByText('Detected format:')).toContainText('JSONL');
    await dialog.getByTestId('wizard-next').click();
    await expect(dialog.getByText('Not imported: extra')).toBeVisible();
    await dialog.getByTestId('wizard-next').click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('[data-dataset-card=good-lines]')).toContainText('2');
  });

  test('name clash offers "Upload as a new version" and creates v2 of the existing dataset', async ({ page, request }) => {
    const p = await createProject(request, 'Wizard Clash', uniqueSlug('wzclash'));
    const existing = await createDataset(request, p.slug, 'Clash Target');
    const v1 = await createVersion(request, p.slug, existing.slug);
    await bulkItems(request, p.slug, existing.slug, v1.version, sampleItems(2));
    const file = tmpFile('c.jsonl', '{"input":"x","expected_output":"y"}\n');
    const dialog = await openNewWizard(page, p.slug);
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('clash target');
    await expect(dialog.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
    await dialog.locator('#wizard-file').setInputFiles(file);
    await dialog.getByTestId('wizard-next').click();
    await expect(dialog.getByText(/A dataset named "Clash Target" already exists\./).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Upload as a new version of Clash Target' }).click();
    const versionDialog = page.getByRole('dialog', { name: 'Upload a new version' });
    await expect(versionDialog).toBeVisible();
    await expect(versionDialog.getByText('New version of')).toBeVisible();
    await versionDialog.getByTestId('wizard-next').click();
    await expect(versionDialog.getByText(/Creates version \S+ of "Clash Target"/)).toBeVisible();
    await versionDialog.getByTestId('wizard-next').click();
    await expect(versionDialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(/Version v2 of "Clash Target" created · 1 item/)).toBeVisible();
    const versions = await request.get(`/v1/datasets/${existing.slug}/versions?project_slug=${p.slug}`);
    expect(((await versions.json()) as { versions: unknown[] }).versions).toHaveLength(2);
  });

  test('Cancel with a chosen file asks to discard; Keep editing keeps it, Discard closes', async ({ page, request }) => {
    const p = await createProject(request, 'Wizard Discard', uniqueSlug('wzdis'));
    await createDataset(request, p.slug, 'Seed Six');
    const file = tmpFile('d.jsonl', '{"input":"x"}\n');
    const dialog = await openNewWizard(page, p.slug);
    // no file yet: Cancel closes immediately
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    await page.getByTestId('new-dataset').click();
    await page.getByRole('menuitem', { name: /Import CSV/ }).click();
    await dialog.locator('#wizard-file').setInputFiles(file);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: 'Discard this upload?' }));
    await expect(confirm.first()).toBeVisible();
    await confirm.first().getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await confirm.first().getByRole('button', { name: 'Discard upload' }).click();
    await expect(dialog).toBeHidden();
  });
});
