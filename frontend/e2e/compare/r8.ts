/** Round 8 helpers: the 4-run and 8-run scenarios and geometry readers keyed by `data-part`. */
import { expect, type Locator, type Page } from '@playwright/test';
import { uniqueSlug } from '../helpers';
import { client, compareUrl, waitLoaded } from './support';
import { createApiKey, ensureProject, seedCompareRun, seedCompareScenario, type CompareSeed } from './seed';

export interface R8Seed {
  seed: CompareSeed;
  four: string[];
  eight: string[];
}

/** The compare scenario plus four more aligned runs (the 8-run page of the spec). */
export async function seedR8(prefix: string): Promise<R8Seed> {
  const slug = uniqueSlug(prefix);
  const seed = await seedCompareScenario(client, slug);
  const project = await ensureProject(client, 'Compare demo', slug);
  const token = await createApiKey(client, project.id);
  const extra: string[] = [];
  const specs = [
    ['cand-d-mini-high', 'openai/gpt-5-mini', 0.2, 7],
    ['cand-e-haiku', 'anthropic/claude-haiku-4', -0.05, 8],
    ['cand-f-large', 'openai/gpt-5', 0.3, 9],
    ['cand-g-flash', 'google/gemini-2.5-flash', 0.05, 10],
  ] as const;
  for (const [i, [name, model, skill, s]] of specs.entries())
    extra.push(await seedCompareRun(client, token, { name, model, skill, seed: s, taskErrors: i === 1 ? [3] : [] }));
  const { base, a, b, c } = seed.runs;
  return { seed, four: [base, a, b, c], eight: [base, a, b, c, ...extra] };
}

export const part = (page: Page, name: string): Locator => page.locator(`[data-part="${name}"]`);

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  bottom: number;
  right: number;
}

export async function box(loc: Locator): Promise<Box> {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error('element has no box');
  return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.y + b.height, right: b.x + b.width };
}

/** Open the compare page at a viewport and wait for the item list. */
export async function openCompare(
  page: Page,
  refs: string[],
  width: number,
  extra: Record<string, string | string[]> = {},
  height = 900,
): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(compareUrl(refs, extra));
  await waitLoaded(page);
}

export const within = (actual: number, expected: number, tol: number, what: string) =>
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected} +-${tol}`).toBeLessThanOrEqual(tol);

/** The shell scroller (the page scrolls inside `main#shell-content`). */
export const shell = (page: Page) => page.locator('#shell-content');

export async function noSidewaysScroll(page: Page): Promise<void> {
  const [sw, cw] = await shell(page).evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw, 'shell scrollWidth').toBeLessThanOrEqual(cw);
}
