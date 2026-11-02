import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/http';
import { editorSetupFrom } from '../../DefaultPresetEditorPage';
import { runPublish, type PublishClient } from '../publish';

const base = '/v1/projects/p1/eval-environments/e1/presets';
const client: PublishClient = {
  create: (body) => api.post(base, body),
  publish: (id, body) => api.post(`${base}/${id}/versions`, body),
};

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

const config = { evaluator: {} };

describe('runPublish', () => {
  it('posts a new version with the trimmed notes', async () => {
    const fetchMock = stubFetch(200, { version: { version: 3 }, warnings: [{ message: 'w' }] });
    const out = await runPublish(client, { presetId: 'pr1', config, notes: '  why  ', fallbackVersion: 3 });
    expect(out).toEqual({ kind: 'ok', version: 3, warnings: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/presets\/pr1\/versions$/);
    expect(JSON.parse(String(init.body))).toEqual({ config, notes: 'why' });
  });

  it('creates the official preset for v1', async () => {
    const fetchMock = stubFetch(200, { preset: { current_version: { version: 1 } }, warnings: [] });
    const out = await runPublish(client, { presetId: null, config, notes: 'first', fallbackVersion: 1 });
    expect(out).toEqual({ kind: 'ok', version: 1, warnings: 0 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      kind: 'official',
      name: 'Default preset',
      notes: 'first',
    });
  });

  it('409: changed meanwhile, with a reload hint', async () => {
    stubFetch(409, { detail: 'The default preset changed meanwhile' });
    const out = await runPublish(client, { presetId: 'pr1', config, notes: 'x', fallbackVersion: 3 });
    expect(out.kind).toBe('conflict');
    expect(out.kind === 'conflict' && out.message).toMatch(/changed meanwhile\. Reload the editor/);
  });

  it('403: clear managers-only message', async () => {
    stubFetch(403, { detail: 'Forbidden' });
    const out = await runPublish(client, { presetId: 'pr1', config, notes: 'x', fallbackVersion: 3 });
    expect(out).toEqual({ kind: 'forbidden', message: 'Only project managers publish the default preset.' });
  });

  it('422: keeps the pointer errors', async () => {
    stubFetch(422, { detail: { errors: [{ pointer: '/env_overrides/X', message: 'too big' }] } });
    const out = await runPublish(client, { presetId: 'pr1', config, notes: 'x', fallbackVersion: 3 });
    expect(out).toMatchObject({
      kind: 'invalid',
      errors: [{ pointer: '/env_overrides/X', message: 'too big' }],
    });
  });
});

describe('editorSetupFrom', () => {
  it('reads ?from=v2 and ?promote=&id=', () => {
    expect(editorSetupFrom(new URLSearchParams('from=v2'), 'e')).toEqual({ environmentId: 'e', from: 2 });
    expect(editorSetupFrom(new URLSearchParams('from=2'), 'e').from).toBe(2);
    expect(editorSetupFrom(new URLSearchParams('promote=saved&id=x&from=v2'), 'e')).toEqual({
      environmentId: 'e',
      promote: { kind: 'saved', id: 'x' },
    });
    expect(editorSetupFrom(new URLSearchParams('promote=bogus&id=x'), 'e')).toEqual({ environmentId: 'e' });
  });
});
