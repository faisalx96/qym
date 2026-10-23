/// <reference lib="dom" />
/**
 * Feedback e2e support: connects the scripted stub model, seeds requests through the API (as dev@local, an
 * administrator under QYM_AUTH_MODE=none), measures boxes and writes the after-screenshots and measurements
 * when QYM_SHOTS_DIR is set (docs/internal/feature-rounds/2026-10-ai-feedback/shots).
 */
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, STUB_LLM_PORT } from '../../playwright.config';

const here = path.dirname(fileURLToPath(import.meta.url));
export const WIDTHS = [1440, 1024, 390] as const;
export type Width = (typeof WIDTHS)[number];
export const COLUMN: Record<Width, number> = { 1440: 1193, 1024: 777, 390: 279 };
const SHOTS = process.env.QYM_SHOTS_DIR;
export const STUB_URL = `http://127.0.0.1:${STUB_LLM_PORT}/v1`;

export async function configureAgent(request: APIRequestContext, script = 'ask_then_propose'): Promise<void> {
  const res = await request.put('/v1/admin/feedback-agent', {
    data: { llm_base_url: STUB_URL, llm_model: `feedback:${script}`, llm_api_key: 'sk-e2e-0000-1234' },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function removeAgent(request: APIRequestContext): Promise<void> {
  const res = await request.delete('/v1/admin/feedback-agent');
  expect(res.status()).toBe(204);
}

/** Eight requests (one confirmed duplicate pair) and `drafts` drafts: idempotent by title. */
export function seedFeedback(drafts = 0): void {
  const python = process.env.QYM_PYTHON ?? 'python';
  execFileSync(python, [path.resolve(here, '..', '..', 'scripts', 'seed_feedback.py'), BASE_URL, '--drafts', String(drafts)], {
    stdio: 'pipe',
    timeout: 120_000,
  });
}

export async function setViewport(page: Page, width: number, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
}

export interface Box {
  w: number;
  h: number;
}

export async function box(locator: Locator): Promise<Box> {
  const b = await locator.first().boundingBox();
  if (!b) throw new Error('element has no box');
  return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
}

/** Within 1 px of the spec's number. */
export function near(actual: number, expected: number, tolerance = 1): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** Write one measurement file (measure/after-e/<name>.json) and merge keys written earlier. */
export function record(name: string, data: Record<string, unknown>): void {
  if (!SHOTS) return;
  const dir = path.resolve(SHOTS, '..', 'measure', 'after-e');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  let prev: Record<string, unknown> = {};
  try {
    prev = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    /* first write */
  }
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...data }, null, 1));
}

export async function shot(page: Page, surface: string, width: number): Promise<void> {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `after-e-${surface}-${width}.png`), fullPage: true });
}

/** Pretend to be a member in the UI (the API still answers as the admin; platform tests cover the 403s). */
export async function asMember(page: Page): Promise<void> {
  await page.route('**/v1/me', async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as Record<string, unknown>;
    await route.fulfill({ response: res, json: { ...body, role: 'MEMBER' } });
  });
}

export async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Count requests whose URL path starts with the prefix. */
export function countCalls(page: Page, prefix: string): { count: () => number; urls: () => string[] } {
  const urls: string[] = [];
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith(prefix)) urls.push(`${r.method()} ${p}`);
  });
  return { count: () => urls.length, urls: () => urls };
}
