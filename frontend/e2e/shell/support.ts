/// <reference lib="dom" />
/**
 * Shell-area e2e support: extra API seeding (users, members, keys) and the
 * axe-core runner. Everything goes through the platform API as dev@local.
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const AXE_PATH = path.resolve(here, '..', '..', 'node_modules', 'axe-core', 'axe.min.js');

export interface SeededUser {
  id: string;
  email: string;
}

/** POST /v1/admin/users (admin only). Returns the existing user when the email is taken. */
export async function createUser(
  request: APIRequestContext,
  email: string,
  displayName = '',
  role: 'MEMBER' | 'MANAGER' | 'ADMIN' = 'MEMBER',
): Promise<SeededUser> {
  const res = await request.post('/v1/admin/users', {
    data: { email, display_name: displayName, role },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as SeededUser;
}

export async function addMember(
  request: APIRequestContext,
  projectId: string,
  userId: string,
  role: 'MEMBER' | 'MANAGER' = 'MEMBER',
): Promise<void> {
  const res = await request.post(`/v1/projects/${projectId}/members`, { data: { user_id: userId, role } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function createApiKey(
  request: APIRequestContext,
  projectId: string,
  name: string,
): Promise<{ id: string; prefix: string; token: string }> {
  const res = await request.post(`/v1/projects/${projectId}/api-keys`, { data: { name } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { id: string; prefix: string; token: string };
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; html: string; data?: unknown }[];
}

/** Runs axe-core in the page and returns the serious + critical violations. */
export async function axeSeriousViolations(page: Page, context?: string): Promise<AxeViolation[]> {
  await page.addScriptTag({ path: AXE_PATH });
  const violations = await page.evaluate(async (ctx) => {
    type AxeResult = { violations: AxeViolation[] };
    type AxeGlobal = { run: (c?: unknown, o?: unknown) => Promise<AxeResult> };
    const axe = (window as unknown as { axe: AxeGlobal }).axe;
    const result = await axe.run(ctx ?? document, {
      resultTypes: ['violations'],
      // The axe "region" rule is moderate; keep only what the brief gates on.
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 5).map((n) => ({
        target: n.target,
        html: n.html.slice(0, 400),
        data: (n as unknown as { any?: { data?: unknown }[] }).any?.[0]?.data,
      })),
    }));
  }, context);
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

export function describeViolations(violations: AxeViolation[]): string {
  return violations
    .map(
      (v) =>
        `${v.impact} ${v.id} (${v.help}):\n  ${v.nodes
          .map((n) => `${n.target.join(' ')}\n    ${n.html}\n    ${JSON.stringify(n.data ?? null)}`)
          .join('\n  ')}`,
    )
    .join('\n');
}

/** The shell content region, the focus target on every route change. */
export async function expectContentFocused(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id ?? ''), { timeout: 3000 })
    .toBe('shell-content');
}
