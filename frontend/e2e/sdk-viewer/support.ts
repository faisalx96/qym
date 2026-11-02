/**
 * Helpers for the SDK viewer suite. Every scenario is started through the fixture's
 * control API (frontend/scripts/sdk_viewer_fixture.py), which runs real qym code.
 */
import { expect, test as base, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

export const LIVE = 'http://127.0.0.1:8818';
export const FILE = 'http://127.0.0.1:8819';
export const CONTROL = 'http://127.0.0.1:8820';

/** Mirrors ROWS in the fixture (dataset order = live row order). */
export const INPUT = {
  wrong: 'What is 2+2?',
  arabic: 'ما هي عاصمة السعودية؟',
  diff: 'Describe the fox',
  raise: 'Explode please',
  long: 'Write a very long answer',
} as const;
export const ERROR_TEXT = 'boom: the task exploded';
export const LONG_OUTPUT = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
export const METRICS = ['exact_match', 'length_ratio'] as const;

export async function control<T = Record<string, unknown>>(
  request: APIRequestContext,
  method: 'GET' | 'POST',
  path: string,
): Promise<T> {
  const res = await request.fetch(`${CONTROL}${path}`, { method });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/** Real evaluation held at: 4 done, 1 error, 2 running, 1 pending. */
export async function startLive(request: APIRequestContext): Promise<void> {
  await control(request, 'POST', '/live/start');
}

/** Release the gated rows and wait for the evaluation to end. */
export async function finishLive(request: APIRequestContext): Promise<void> {
  const res = await control<{ finished: boolean }>(request, 'POST', '/live/release');
  expect(res.finished).toBe(true);
}

export async function freshFile(request: APIRequestContext): Promise<{ path: string; url: string }> {
  const { path } = await control<{ path: string }>(request, 'POST', '/file/fresh');
  return { path, url: `${FILE}/run/${encodeURIComponent(path)}` };
}

export const rows = (page: Page): Locator => page.locator('tbody tr[data-row]');
export const rowByInput = (page: Page, input: string): Locator =>
  page.locator('tbody tr[data-row]').filter({ hasText: input });
export const detail = (page: Page): Locator => page.locator('article[aria-labelledby="detail-title"]');
export const countText = (page: Page): Locator => page.getByText(/^\d+ of \d+ rows$/);

/** Console errors/warnings and uncaught exceptions seen by the page. */
export const test = base.extend<{ consoleIssues: string[]; allowConsoleIssues: boolean }>({
  allowConsoleIssues: [false, { option: true }],
  consoleIssues: [
    async ({ page, allowConsoleIssues }, use) => {
      const issues: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') issues.push(`${m.type()}: ${m.text()}`);
      });
      page.on('pageerror', (e) => issues.push(`pageerror: ${e.message}`));
      await use(issues);
      if (!allowConsoleIssues) expect(issues, 'console errors or warnings').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

/** No serious or critical axe violations on the page as it is now. */
export async function expectNoSeriousA11y(page: Page, context?: string): Promise<void> {
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async () => {
    type Violation = { id: string; impact?: string | null; nodes: Array<{ target: unknown[] }> };
    const axe = (
      window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: Violation[] }> } }
    ).axe;
    const res = await axe.run(document, { resultTypes: ['violations'] });
    return res.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')),
      }));
  });
  expect(violations, `axe${context ? ` (${context})` : ''}`).toEqual([]);
}

const BOM = String.fromCharCode(0xfeff);

/** Parse the CSV the viewer exports (UTF-8 BOM, CRLF, quoted fields). */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}
