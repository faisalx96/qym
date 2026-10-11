/** Shared UI helpers for the datasets / reviews / trash e2e specs. */
import { expect, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';


export const TMP_DIR = '/tmp/claude-1000/-home-meshari-aldossari-Documents-qym-qym/61846e82-dc0e-402d-b3ec-d3565a3b1b04/scratchpad/dsx-test';

export function tmpFile(name: string, content: string | Buffer): string {
  mkdirSync(TMP_DIR, { recursive: true });
  const p = path.join(TMP_DIR, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${name}`);
  writeFileSync(p, content);
  return p;
}

/** Opens a react-aria Select by its label and picks an option. */
export async function pickSelect(scope: Page | Locator, label: string | RegExp, option: string | RegExp): Promise<void> {
  const page = 'page' in scope ? (scope as Locator).page() : (scope as Page);
  const trigger = scope.getByRole('button', { name: label });
  await trigger.click();
  await page.getByRole('option', { name: option }).first().click();
}

export function appPath(slug: string, tail: string): string {
  return `/projects/${slug}/${tail}`;
}

export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}

export function query(page: Page): URLSearchParams {
  return new URL(page.url()).searchParams;
}
