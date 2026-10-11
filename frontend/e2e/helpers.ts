/**
 * Shared e2e helpers. Seeding goes through the API as dev@local (ADMIN under
 * QYM_AUTH_MODE=none), never by editing the DB.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const APP = '/app';

export interface SeededProject {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
}

export async function createProject(
  request: APIRequestContext,
  name: string,
  slug?: string,
): Promise<SeededProject> {
  const res = await request.post('/v1/projects', { data: { name, slug } });
  if (res.status() === 400 && slug) {
    // already exists from an earlier spec: look it up
    const existing = await request.get(`/v1/projects/by-slug/${encodeURIComponent(slug)}`);
    expect(existing.ok()).toBeTruthy();
    return (await existing.json()) as SeededProject;
  }
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as SeededProject;
}

export async function archiveProject(request: APIRequestContext, projectId: string): Promise<void> {
  const res = await request.post(`/v1/admin/projects/${projectId}/archive`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function unarchiveProject(request: APIRequestContext, projectId: string): Promise<void> {
  const res = await request.post(`/v1/admin/projects/${projectId}/unarchive`);
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Unique slug per test run so specs never collide. */
export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function gotoApp(page: Page, path = '/'): Promise<void> {
  await page.goto(`${APP}${path === '/' ? '/' : path}`);
}

/** Counts full page loads; assert it stays at 1 for in-app navigation. */
export function trackPageLoads(page: Page): { count: () => number } {
  let loads = 0;
  page.on('load', () => loads++);
  return { count: () => loads };
}
