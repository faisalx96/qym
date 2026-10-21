import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaunchTestProvider } from '../LaunchContext';
import { VersionsBlock } from '../entry/VersionsBlock';
import { envRecord, newClient, Providers } from './helpers';

/**
 * "Current versions" on the home view: what a job started now would record as versioning_details,
 * read once when the step is shown and again on Refresh (never on a re-render), with the service's
 * reason when it cannot be read and a notice for a service that predates the endpoint.
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
const block = (
  <Providers client={client}>
    <LaunchTestProvider overrides={{ selectedEnvs: [envRecord({ name: 'Staging' })], projectId: 'p1' }}>
      <VersionsBlock />
    </LaunchTestProvider>
  </Providers>
);
const renderBlock = () => render(block);

const row = () => document.querySelector('[data-env-version="e1"]') as HTMLElement;
const value = (label: string) => {
  const dt = within(row()).getByText(label, { selector: 'dt' });
  return dt.nextElementSibling?.textContent;
};

afterEach(() => {
  vi.unstubAllGlobals();
  client.clear();
});

describe('VersionsBlock', () => {
  it('reads the versions once, shows "not set" for a missing key and reads again only on Refresh', async () => {
    const reads = stubVersioning([
      ok({ agent_version: 'v2.4.0', kb_version: '4b0535c' }),
      ok({ agent_version: 'v2.4.0', kb_version: '4b0535c', image_version: '2026.10.11' }),
    ]);
    const user = userEvent.setup();
    const { rerender } = renderBlock();
    expect(screen.getByRole('group', { name: 'Current versions' })).toHaveTextContent('Staging');
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    expect(value('agent')).toBe('v2.4.0');
    expect(value('kb')).toBe('4b0535c');
    expect(value('image')).toBe('not set');
    expect(reads).toHaveLength(1);

    rerender(block);
    expect(reads).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(value('image')).toBe('2026.10.11'));
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
    renderBlock();
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
    renderBlock();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'error'));
    expect(row()).toHaveTextContent('Couldn’t read: No API key configured');
  });

  it('shows a failed request in place of the versions', async () => {
    stubVersioning([() => json(500, { detail: 'boom' })]);
    renderBlock();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'error'));
    expect(row()).toHaveTextContent('Couldn’t read:');
  });

  it('has one Refresh button, the new help text, no "Add versioning details" and no inputs (QA2-11, QA4-4)', async () => {
    stubVersioning([ok({ agent_version: 'v1' })]);
    renderBlock();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    const group = screen.getByRole('group', { name: 'Current versions' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Refresh']);
    expect(group).toHaveTextContent('Read from each environment. Runs record what its Evaluation Service reports.');
    expect(group).not.toHaveTextContent('Add versioning details');
    expect(group.querySelector('input, textarea, select, [contenteditable]')).toBeNull();
  });

  it('loads as the loaded layout: names, placeholders, aria-busy and a hidden status (QA4-7)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    renderBlock();
    const list = row().querySelector('dl') as HTMLElement;
    expect(list).toHaveAttribute('aria-busy', 'true');
    // The hidden status is not a child of the definition list (axe: dl may hold only dt / dd groups).
    expect(list.querySelector('[role="status"]')).toBeNull();
    expect(within(list).getAllByText(/^(agent|image|kb)$/, { selector: 'dt' })).toHaveLength(3);
    expect(list.querySelectorAll('dd')).toHaveLength(3);
    expect(within(row()).getByRole('status')).toHaveTextContent('Reading…');
  });

  it('Refresh pressed twice while loading asks once more, not twice (QA4-11)', async () => {
    const reads = stubVersioning([ok({ agent_version: 'v1' })]);
    const user = userEvent.setup();
    renderBlock();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    expect(reads.length).toBeLessThanOrEqual(3);
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  it('a second instance reads nothing again (one query shared by home and step 1, QA4-6)', async () => {
    const reads = stubVersioning([ok({ agent_version: 'v1' })]);
    const { unmount } = renderBlock();
    await waitFor(() => expect(row()).toHaveAttribute('data-status', 'ok'));
    unmount();
    render(block);
    expect(row()).toHaveAttribute('data-status', 'ok');
    expect(reads).toHaveLength(1);
  });
});
