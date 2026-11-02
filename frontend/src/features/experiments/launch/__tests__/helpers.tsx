/** Test scaffolding of the launch form: a fake platform behind `fetch`, a QueryClient, a router. */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { EvalEnvironment } from '@/api/evalCommon';
import { ToastProvider } from '@/ui';

export function envRecord(over: Partial<EvalEnvironment> = {}): EvalEnvironment {
  return {
    id: 'e1',
    project_id: 'p1',
    name: 'staging',
    description: '',
    base_url: 'http://svc',
    api_key_set: true,
    api_key_hint: null,
    default_priority: 'NORMAL',
    max_priority: 'HIGH',
    latency_sensitive_min_role: 'member',
    allow_connection_keys: true,
    ranking_metric: null,
    ranking_k: null,
    current_schema_id: 's1',
    schema_hash: 'h1',
    schema_fetched_at: null,
    evaluator_schema_status: null,
    current_evaluator_schema_id: null,
    evaluator_schema_hash: null,
    evaluator_schema_fetched_at: null,
    health_status: 'ok',
    health_checked_at: null,
    health_error: null,
    is_active: true,
    model_slots: { needs_confirmation: false, counts: { confirmed: 0, proposed: 0, stale: 0 } },
    official_preset_id: 'pr1',
    official_preset_version_id: 'pv1',
    official_preset_version: 1,
    created_by_user_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

export function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
}

export function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export interface FakePlatform {
  calls: Array<{ method: string; url: string; body: unknown }>;
  /** Responses for non-dry-run POST /experiments, consumed in order (then success). */
  launchResponses: Array<{ status: number; body: unknown }>;
  /** What the schema refresh answers (default: nothing changed). */
  schemaRefresh: Record<string, unknown>;
}

/** Installs a fetch that behaves like the platform for one environment (`e1`). */
export function installFakePlatform(envs: EvalEnvironment[] = [envRecord()]): FakePlatform {
  const state: FakePlatform = { calls: [], launchResponses: [], schemaRefresh: { changed: false } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      state.calls.push({ method, url, body });
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      if (/\/eval-environments\?active=true$/.test(path)) return json(200, { environments: envs });
      if (/\/schema\/refresh$/.test(path)) return json(200, state.schemaRefresh);
      if (/\/form$/.test(path))
        return json(200, {
          environment_id: 'e1',
          schema_id: 's1',
          schema_hash: 'h1',
          descriptor: { root: [], fields: {}, groups: [] },
          evaluator: null,
        });
      if (/\/model-slots/.test(path)) return json(200, { slots: [], needs_confirmation: false });
      if (/\/model-options$/.test(path))
        return json(200, { temporary_keys_allowed: true, temporary_keys_reason: null, connections: [] });
      if (/\/presets$/.test(path))
        return json(200, {
          environment_id: 'e1',
          can_publish_official: true,
          presets: [
            {
              id: 'pr1',
              name: 'Default',
              kind: 'official',
              current_version_id: 'pv1',
              current_version: { id: 'pv1', version: 1, config: {}, notes: 'Release one' },
            },
          ],
        });
      if (/\/presets\/pr1\/versions\/1/.test(path))
        return json(200, {
          version: { id: 'pv1', version: 1, notes: 'Release one', warnings: [] },
          remap: {
            ok: true,
            config: { evaluator: { dataset: 'ds1' }, slot_bindings: {}, env_overrides: {} },
            dropped: [],
            errors: [],
          },
        });
      if (/evaluator-config/.test(path))
        return json(200, {
          descriptor: { root: [], fields: {}, groups: [] },
          fields: [],
          missing: {},
          platform_owned: { config: [], evaluator: [] },
          reserved_metadata_prefix: 'qym_',
        });
      if (/\/v1\/datasets\/[^/]+\/versions/.test(path))
        return json(200, { versions: [{ version: 'v1', aliases: [] }] });
      if (/\/experiments\/launch-datasets/.test(path))
        return json(200, {
          datasets: ['ds1', 'ds2'].map((name) => ({
            id: name,
            name,
            slug: name,
            private_test_set: false,
            access_mode: 'project',
          })),
        });
      if (/\/experiments\?limit=1/.test(path)) return json(200, { experiments: [] });
      if (/\/experiments$/.test(path) && method === 'POST') {
        const b = body as { dry_run?: boolean };
        if (b.dry_run)
          return json(200, {
            dry_run: true,
            ok: true,
            errors: [],
            job_count: 1,
            combo_count: 1,
            max_jobs: 8,
            jobs: [],
          });
        const next = state.launchResponses.shift();
        if (next) return json(next.status, next.body);
        return json(200, { id: 'x1' });
      }
      return json(404, { detail: 'not found: ' + path });
    }),
  );
  return state;
}
