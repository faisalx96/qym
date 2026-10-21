/** WP-A e2e seeding through the public API as dev@local (ADMIN under QYM_AUTH_MODE=none). */
import { expect, type APIRequestContext, type APIResponse, type Locator, type Page, type Route } from '@playwright/test';
import { createProject, createUser, uniqueSlug } from '../helpers';
import { bulkItems, createDataset, createVersion, publishVersion, sampleItems, type SeedItem } from './support';

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

// ---- shared by access.spec.ts and access-tab.spec.ts ----

export async function seedProject(request: APIRequestContext, prefix: string) {
  const project = await createProject(request, `Access ${prefix}`, uniqueSlug(prefix));
  const people = await addMembers(request, project.id, [
    'Noura Alharbi',
    'Khalid Almutairi',
    'Sara Alqahtani',
    'Omar Alharbi',
  ]);
  const publish = async (name: string, extra: Record<string, unknown> = {}) => {
    const d = await createDataset(request, project.slug, name, extra);
    const v = await createVersion(request, project.slug, d.slug);
    await bulkItems(request, project.slug, d.slug, v.version, sampleItems(6));
    await publishVersion(request, project.slug, d.slug, v.version, true);
    return d;
  };
  return { project, people, publish };
}

/** A platform answer being rewritten (loosely typed on purpose). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type JsonObject = Record<string, any>;

/** Rewrite the JSON answer of the requests matching `url`. */
export async function rewrite(page: Page, url: RegExp, patch: (body: JsonObject) => void, status?: number) {
  await page.route(url, async (route: Route) => {
    try {
      const res = await route.fetch();
      const body = (await res.json()) as JsonObject;
      patch(body);
      await route.fulfill({ response: res, json: body, status: status ?? res.status() });
    } catch {
      // the page closed while the answer was in flight (the end of a test): nothing left to rewrite
      await route.fallback().catch(() => undefined);
    }
  });
}

export const DATASET_GET = /\/v1\/datasets\/[^/?]+\?project_slug=/;
export const ACCESS_GET = /\/v1\/datasets\/[^/?]+\/access\?/;

/** The caller reads the dataset with `view` access only. */
export async function asViewer(page: Page, restricted = true) {
  await rewrite(page, DATASET_GET, (b) => {
    const d = b.dataset;
    if (restricted) d.access_mode = 'restricted';
    Object.assign(d.permissions, {
      access_level: 'view',
      can_modify: false,
      can_manage_access: false,
      can_manage: false,
      can_delete: false,
      can_rename_slug: false,
      can_move_production: false,
      can_set_production: false,
    });
  });
  await rewrite(page, ACCESS_GET, (b) => {
    Object.assign(b, { can_manage_access: false, candidates: [], your_level: 'view' });
  });
}


const TAGS = ['billing', 'refund', 'shipping', 'account', 'vip', 'urgent', 'fraud', 'arabic'];
const LABELS = ['gold', 'silver', 'reviewed', 'needs-review', 'synthetic'];

/**
 * The design seed's items (`measure/seed-qa-a.mts`): list metadata `tags`, `source.labels`, `levels`, a mixed `channels`,
 * `attachments` (list of objects) and `flags` (empty lists), next to the scalar keys. With 130 items: tags billing+refund
 * partial 46 / full 6; channels chat 87; source.labels gold+reviewed partial 65 / full 13.
 */
export function listMetadataItems(n = 130, prefix = 'faq'): SeedItem[] {
  return Array.from({ length: n }, (_, i) => {
    const tags = [TAGS[i % 8]!, ...(i % 3 === 0 ? [TAGS[(i + 1) % 8]!] : []), ...(i % 5 === 0 ? [TAGS[(i + 3) % 8]!] : [])];
    return {
      item_id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
      input: `What is the refund policy for order #${i + 1}?`,
      expected_output: `Refunds within 30 days for order #${i + 1}.`,
      metadata: {
        domain: i < 42 ? 'finance' : DOMAINS[1 + (i % 3)],
        difficulty: i % 3,
        tags: [...new Set(tags)],
        source: {
          region: { code: REGIONS[i % 4] },
          channel: i % 2 ? 'chat' : 'email',
          labels: i % 2 === 0 ? [LABELS[i % 5], LABELS[(i + 2) % 5]] : [LABELS[i % 5]],
        },
        channels: i % 3 === 0 ? ['chat', 'email', 'phone'].slice(0, 1 + (i % 2) + 1) : i % 2 ? 'chat' : 'email',
        attachments: i % 4 === 0 ? [{ kind: 'pdf', pages: 2 }] : [],
        flags: [],
        levels: [i % 3, (i % 3) + 1],
      },
      labels: [],
    };
  });
}
