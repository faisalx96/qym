/** WP-A e2e seeding through the public API as dev@local (ADMIN under QYM_AUTH_MODE=none). */
import { expect, type APIRequestContext, type APIResponse, type Locator } from '@playwright/test';
import { createUser } from '../helpers';
import type { SeedItem } from './support';

async function ok<T>(p: Promise<APIResponse>): Promise<T> {
  const res = await p;
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

export interface Person {
  id: string;
  email: string;
  name: string;
}

/** Create users and make them ordinary members of the project. */
export async function addMembers(
  request: APIRequestContext,
  projectId: string,
  names: string[],
): Promise<Person[]> {
  const out: Person[] = [];
  for (const name of names) {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${Date.now().toString(36)}@e2e.local`;
    const user = await createUser(request, email, name);
    await ok(
      request.post(`/v1/projects/${projectId}/members`, { data: { user_id: user.id, role: 'MEMBER' } }),
    );
    out.push({ id: user.id, email, name });
  }
  return out;
}

export async function setAccess(
  request: APIRequestContext,
  slug: string,
  ref: string,
  mode: 'project' | 'restricted',
  grants: { user_id: string; level: 'view' | 'modify' }[] = [],
) {
  return ok<Record<string, unknown>>(
    request.put(`/v1/datasets/${encodeURIComponent(ref)}/access?project_slug=${slug}`, {
      data: { access_mode: mode, grants },
    }),
  );
}

export async function disableItems(
  request: APIRequestContext,
  slug: string,
  ref: string,
  version: string,
  itemIds: string[],
  reason = '',
) {
  for (const id of itemIds) {
    await ok(
      request.post(
        `/v1/datasets/${encodeURIComponent(ref)}/versions/${version}/items/${encodeURIComponent(id)}:disable?project_slug=${slug}`,
        { data: reason ? { reason } : {} },
      ),
    );
  }
}

export async function batch(
  request: APIRequestContext,
  slug: string,
  ref: string,
  version: string,
  body: Record<string, unknown>,
) {
  return ok<{ matched: number; affected: number; sample_item_ids: string[] }>(
    request.post(
      `/v1/datasets/${encodeURIComponent(ref)}/versions/${version}/items:batch?project_slug=${slug}`,
      {
        data: body,
      },
    ),
  );
}

const DOMAINS = ['finance', 'health', 'retail', 'legal'];
const REGIONS = ['sa', 'ae', 'eg', 'kw'];

/** Items with nested metadata (domain, difficulty, source.region.code, source.channel), like the design seed. */
export function metadataItems(n: number, financeCount = Math.floor(n / 3), prefix = 'faq'): SeedItem[] {
  return Array.from({ length: n }, (_, i) => {
    const arabic = i % 5 === 0;
    return {
      item_id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
      input: arabic
        ? `ما هي سياسة الاسترجاع للطلب رقم ${i + 1}؟`
        : `What is the refund policy for order #${i + 1}?`,
      expected_output: arabic
        ? 'يمكنك إرجاع المنتج خلال 30 يوماً'
        : `Refunds within 30 days for order #${i + 1}.`,
      metadata: {
        domain: i < financeCount ? 'finance' : DOMAINS[1 + (i % 3)],
        difficulty: i % 3,
        source: { region: { code: REGIONS[i % 4] }, channel: i % 2 ? 'chat' : 'email' },
      },
      labels: arabic ? ['arabic'] : i % 7 === 0 ? ['edge'] : [],
    };
  });
}

export async function size(locator: Locator): Promise<{ w: number; h: number }> {
  const box = await locator.boundingBox();
  expect(box, 'element has a box').not.toBeNull();
  return { w: box!.width, h: box!.height };
}

/** Whole-pixel-tenth comparison: a measured number is within 0.5 px of the spec's. */
export function near(actual: number, expected: number, tolerance = 0.6): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

export const WIDTHS = [1440, 1024, 390] as const;
