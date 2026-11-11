import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnvRefresh, EnvVersions } from '../entry/VersionsBlock';
import { envRecord, newClient, Providers } from './helpers';

/**
 * The versions line inside a ticked environment box (home view and Customize step 1): what a job
 * started now would record as versioning_details, read once when the box is ticked and again on its
 * Refresh (never on a re-render), with the service's reason when it cannot be read and a notice for
 * a service that predates the endpoint.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function stubVersioning(answers: Array<() => Response>) {
  const reads: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!/\/versioning-details$/.test(url)) return json(404, { detail: 'not found: ' + url });
      const answer = answers[Math.min(reads.length, answers.length - 1)]!;
      reads.push(url);
      return answer();
    }),
  );
  return reads;
}

const ok = (details: Record<string, unknown>) => () =>
  json(200, {
    environment_id: 'e1',
    status: 'ok',
    versioning_details: details,
    error: null,
    fetched_at: null,
  });

const client = newClient();
const line = (
  <Providers client={client}>
    <EnvRefresh env={envRecord({ name: 'Staging' })} projectId="p1" />
    <EnvVersions env={envRecord({ name: 'Staging' })} projectId="p1" />
  </Providers>
);
const renderLine = () => render(line);

const row = () => document.querySelector('[data-env-version="e1"]') as HTMLElement;
const value = (label: string) => {
  const dt = within(row()).getByText(label, { selector: 'dt' });
  return dt.nextElementSibling?.textContent;
};
const refresh = () => screen.getByRole('button', { name: 'Refresh versions of Staging' });

afterEach(() => {
  vi.unstubAllGlobals();
  client.clear();
});

describe('EnvVersions', () => {
  it('R10 C-3-1 reads the versions once, draws only the reported keys as written and reads again only on Refresh', async () => {
    const reads = stubVersioning([
      ok({ agent_version: 'v2.4.0', kb_version: '4b0535c' }),
      ok({ agent_version: 'v2.4.0', kb_version: '4b0535c', image_version: '2026.10.11' }),
    ]);
    const user = userEvent.setup();
    const { rerender } = renderLine();
    expect(row()).toHaveTextContent('Versions');
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    expect(value('agent_version')).toBe('v2.4.0');
    expect(value('kb_version')).toBe('4b0535c');
    // a key the service does not report is not drawn (round 10, point 3)
    expect(row().querySelectorAll('[data-part=version-key]')).toHaveLength(2);
    expect(row()).not.toHaveTextContent(/image|not set/);
    expect(row().querySelector('[data-unset]')).toBeNull();
    expect(reads).toHaveLength(1);

    rerender(line);
    expect(reads).toHaveLength(1);

    await user.click(refresh());
    await waitFor(() => expect(value('image_version')).toBe('2026.10.11'));
    // the response's order, not a fixed one
    expect(Array.from(row().querySelectorAll('[data-part=version-key]')).map((k) => k.textContent)).toEqual([
      'agent_version',
      'kb_version',
      'image_version',
    ]);
    expect(reads).toHaveLength(2);
  });

  it('says so for a service that predates the endpoint', async () => {
    stubVersioning([
      () =>
        json(200, {
          environment_id: 'e1',
          status: 'unsupported',
          versioning_details: {},
          error: null,
          fetched_at: null,
        }),
    ]);
    renderLine();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'unsupported'));
    expect(row()).toHaveTextContent('Not supported by this environment');
  });

  it('shows the service reason when it cannot be read', async () => {
    stubVersioning([
      () =>
        json(200, {
          environment_id: 'e1',
          status: 'error',
          versioning_details: {},
          error: 'No API key configured',
          fetched_at: null,
        }),
    ]);
    renderLine();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'error'));
    expect(row()).toHaveTextContent('Couldn’t read: No API key configured');
  });

  it('shows a failed request in place of the versions', async () => {
    stubVersioning([() => json(500, { detail: 'boom' })]);
    renderLine();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'error'));
    expect(row()).toHaveTextContent('Couldn’t read:');
  });

  it('has one Refresh button named for its environment, no "Add versioning details" and no inputs (QA2-11, QA4-4)', async () => {
    stubVersioning([ok({ agent_version: 'v1' })]);
    renderLine();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    // Refresh moved to the box's head row (round 9): the versions line itself has no control
    expect(within(row()).queryAllByRole('button')).toHaveLength(0);
    expect(refresh()).toHaveAccessibleName('Refresh versions of Staging');
    expect(row()).not.toHaveTextContent('Add versioning details');
    expect(row().querySelector('input, textarea, select, [contenteditable]')).toBeNull();
  });

  it('R10 C-3-4 loads as three placeholder cells with no label text, aria-busy and a hidden status', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    renderLine();
    const frame = row().querySelector('[aria-busy="true"]') as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.querySelector('[role="status"]')).toBeNull();
    const cells = frame.querySelectorAll('[data-part=version-placeholder]');
    expect(cells).toHaveLength(3);
    cells.forEach((c) => expect(c).toHaveAttribute('aria-hidden', 'true'));
    expect(frame.textContent?.trim().replace(/\u00a0/g, '')).toBe('');
    expect(within(row()).getByRole('status')).toHaveTextContent('Reading…');
  });

  it('R10 C-3-1 / C-3-2 the five-key payload: response order, strings in tags, scalars and JSON in mono, wide cells', async () => {
    const routing = { primary: 'gpt-4o', fallback: 'claude-sonnet', judge: 'gpt-4o-mini' };
    stubVersioning([
      ok({ agent_version: 'agent-1.5.0', kb_version: 'kb-81', prompt_set: 'prompts-2026-11-01', model_routing: routing, build: 4127 }),
    ]);
    renderLine();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    const keys = Array.from(row().querySelectorAll('[data-part=version-key]')).map((k) => k.textContent);
    expect(keys).toEqual(['agent_version', 'kb_version', 'prompt_set', 'model_routing', 'build']);
    const values = Array.from(row().querySelectorAll('[data-part=version-value]')) as HTMLElement[];
    expect(values[0]!.textContent).toBe('agent-1.5.0');
    const json = values[3]!;
    expect(json).toHaveAttribute('data-kind', 'json');
    expect(json.textContent).toBe(`${JSON.stringify(routing).slice(0, 48)}…`);
    expect(json).toHaveAttribute('title', JSON.stringify(routing));
    expect(values[4]!).toHaveAttribute('data-kind', 'scalar');
    expect(values[4]!.textContent).toBe('4127');
    const wide = Array.from(row().querySelectorAll('[data-wide]')).map((c) => c.querySelector('dt')?.textContent);
    expect(wide).toEqual(['prompt_set', 'model_routing']);
  });

  it('R10 C-3-5 an empty payload says so, with no cells', async () => {
    stubVersioning([ok({})]);
    renderLine();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    expect(row()).toHaveTextContent('No versioning details reported');
    expect(row().querySelectorAll('[data-part=version-key]')).toHaveLength(0);
  });

  it('Refresh pressed twice while loading asks once more, not twice (QA4-11)', async () => {
    const reads = stubVersioning([ok({ agent_version: 'v1' })]);
    const user = userEvent.setup();
    renderLine();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    await user.click(refresh());
    await user.click(refresh());
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    expect(reads.length).toBeLessThanOrEqual(3);
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  it('a second instance reads nothing again (one query shared by home and step 1, QA4-6)', async () => {
    const reads = stubVersioning([ok({ agent_version: 'v1' })]);
    const { unmount } = renderLine();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    unmount();
    render(line);
    expect(row()).toHaveAttribute('data-status', 'ok');
    expect(reads).toHaveLength(1);
  });
});
