import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { PerformanceTarget, PerformanceTargetsRead } from '@/api/performance';
import { performanceTargets } from '@/features/dev/performanceFixtures';
import { TargetsPage } from '../TargetsPage';
import { reads, refusal, response, setup, switchedOff, writes, type Role } from './areaHarness';

// The Targets list: every target, archived ones too; only a manager adds, edits, archives and restores.
const archived: PerformanceTarget = {
  ...performanceTargets[0]!,
  id: 'target-old-preprod',
  name: 'Old preprod',
  base_url: 'https://insightor.old-preprod.example.org',
  tokens: [],
  sign_in_ready: false,
  last_run: null,
  archived_at: '2026-11-01T08:00:00Z',
};
const list = (over: Partial<PerformanceTargetsRead> = {}): PerformanceTargetsRead => ({
  targets: [archived, ...performanceTargets],
  can_manage: true,
  encryption_ready: true,
  platform_limits: { max_users: 200, max_duration_s: 28_800 },
  ...over,
});

function open(
  read: PerformanceTargetsRead | (() => Response),
  options: { role?: Role; write?: Parameters<typeof setup>[1]['server']['write'] } = {},
) {
  return setup(<TargetsPage slug="demo" />, {
    role: options.role,
    path: '/projects/demo/performance/targets',
    server: { reads: { '/targets': typeof read === 'function' ? read : () => read }, write: options.write },
  });
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-performance-target="${id}"]`)!;
/** The loading frame already draws the table (its skeleton rows): wait for the targets themselves. */
const loaded = () =>
  waitFor(() => expect(document.querySelector('[data-performance-target]')).not.toBeNull());

it('lists every target, the ones in use first and the archived ones after them', async () => {
  open(list());
  await loaded();
  expect(document.title).toContain('Targets · Performance');
  const ids = [...document.querySelectorAll('[data-performance-target]')].map((item) =>
    item.getAttribute('data-performance-target'),
  );
  expect(ids).toEqual([...performanceTargets.map((target) => target.id), 'target-old-preprod']);
  expect(row('target-old-preprod')).toHaveAttribute('data-archived');
  // Archived is the grey Flag after the name; production is the environment's green StateTag (as Live).
  expect(row('target-old-preprod')).toHaveTextContent('Archived');
  expect(row('target-production')).toHaveTextContent('Production');
  // Who changed what, and a saved token by its last four characters only.
  expect(row('target-playground-17')).toHaveTextContent('Refresh token ends in 9f3c');
  expect(row('target-playground-17')).toHaveTextContent(/Added .* by /);
  expect(row('target-old-preprod')).toHaveTextContent(/Archived \w{3} \d/);
  expect(
    screen.getByText(/the platform lets a run reach at most 200 users and last at most 8h/),
  ).toBeInTheDocument();
});

it('gives a manager Add, Edit and Archive on targets in use and Restore on archived ones', async () => {
  open(list());
  await loaded();
  expect(screen.getByRole('button', { name: 'Add target' })).toBeEnabled();
  const inUse = within(row('target-preprod'));
  expect(inUse.getByRole('button', { name: 'Edit' })).toBeEnabled();
  expect(inUse.getByRole('button', { name: 'Archive' })).toBeEnabled();
  expect(inUse.queryByRole('button', { name: 'Restore' })).toBeNull();
  const old = within(row('target-old-preprod'));
  expect(old.getByRole('button', { name: 'Restore' })).toBeEnabled();
  expect(old.queryByRole('button', { name: 'Edit' })).toBeNull();
});

it.each<Role>(['member', 'viewer'])(
  'shows a %s every write locked in place, with the reason',
  async (role) => {
    open(list({ can_manage: false }), { role });
    await loaded();
    const add = screen.getByRole('button', { name: 'Add target' });
    expect(add).toBeDisabled();
    expect(add).toHaveAccessibleDescription('Only a project manager can change targets');
    for (const name of ['Edit', 'Archive'])
      expect(within(row('target-preprod')).getByRole('button', { name }), name).toBeDisabled();
    expect(within(row('target-old-preprod')).getByRole('button', { name: 'Restore' })).toBeDisabled();
    expect(document.querySelectorAll('[data-performance-target]')).toHaveLength(5);
  },
);

it('opens the Add and Edit dialog of the New run page', async () => {
  open(list());
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add target' }));
  expect(await screen.findByRole('dialog', { name: 'Add a target' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(within(row('target-preprod')).getByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit target' });
  expect(within(dialog).getByRole('textbox', { name: /Name/ })).toHaveValue('Preprod');
});

it('archives a target after the question', async () => {
  const view = open(list(), { write: () => response(null, 204) });
  const user = userEvent.setup();
  await loaded();
  await user.click(within(row('target-preprod')).getByRole('button', { name: 'Archive' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Archive the target “Preprod”?' });
  await user.click(within(dialog).getByRole('button', { name: 'Archive target' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  expect(writes(view.fetch)).toEqual([['DELETE', '/targets/target-preprod', {}]]);
});

it('keeps a refused archive in the dialog, in the words of the answer', async () => {
  const view = open(list(), {
    write: () =>
      refusal(409, 'target_busy', 'Run 24 is running on Preprod. Archive it when the run has ended.', {
        run_id: 'run-0024',
      }),
  });
  const user = userEvent.setup();
  await loaded();
  await user.click(within(row('target-preprod')).getByRole('button', { name: 'Archive' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Archive the target “Preprod”?' });
  const before = reads(view.fetch, '/targets').length;
  await user.click(within(dialog).getByRole('button', { name: 'Archive target' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'Run 24 is running on Preprod. Archive it when the run has ended.',
  );
  await waitFor(() => expect(reads(view.fetch, '/targets').length).toBeGreaterThan(before));
});

it('restores an archived target, and shows a refusal in its words while the list is read again', async () => {
  const view = open(list(), {
    write: () =>
      refusal(409, 'target_address_taken', 'Preprod already uses this address. Archive it first.', {
        target_id: 'target-preprod',
        name: 'Preprod',
      }),
  });
  const user = userEvent.setup();
  await loaded();
  const before = reads(view.fetch, '/targets').length;
  await user.click(within(row('target-old-preprod')).getByRole('button', { name: 'Restore' }));
  const notice = await screen.findByTestId('performance-target-refusal');
  expect(notice).toHaveTextContent(/^Old preprod was not restored\./);
  expect(notice).toHaveTextContent('Preprod already uses this address. Archive it first.');
  expect(writes(view.fetch)).toEqual([['POST', '/targets/target-old-preprod/restore', {}]]);
  await waitFor(() => expect(reads(view.fetch, '/targets').length).toBeGreaterThan(before));
});

it('says sign-in cannot be saved while the platform has no encryption key', async () => {
  open(list({ encryption_ready: false }));
  expect(await screen.findByText('Sign-in cannot be saved yet.')).toBeInTheDocument();
});

it('says plainly that the area is switched off, without an error or Retry', async () => {
  open(switchedOff);
  expect(await screen.findByText('Performance tests are switched off')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /retry|try again/i })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add target' })).toBeNull();
});

it('opens Advanced only when values are set, and saves minutes as seconds', async () => {
  const view = open(list(), {
    write: (_url, _method, body) => response({ ...performanceTargets[0], ...body }),
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add target' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Add a target' }));
  const advanced = dialog.getByRole('button', { name: 'Advanced' });
  expect(advanced).toHaveAttribute('aria-expanded', 'false');
  await user.click(advanced);
  expect(dialog.getByRole('textbox', { name: 'Sign-in cookie name' })).toHaveAttribute(
    'placeholder',
    'estishraf_rt',
  );
  await user.type(dialog.getByRole('textbox', { name: /Name/ }), 'Internal production');
  await user.type(dialog.getByRole('textbox', { name: /Address/ }), 'http://chat:8080');
  await user.click(dialog.getByRole('textbox', { name: 'Sign-in server' }));
  await user.paste('http://[fd12:3456::1]:8080');
  await user.type(dialog.getByRole('textbox', { name: 'Sign-in cookie name' }), 'production_rt');
  await user.type(dialog.getByRole('textbox', { name: 'Longest run, minutes' }), '15');
  await user.click(dialog.getByRole('button', { name: 'Save target' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(view.fetch)[0]?.[2]).toMatchObject({
    base_url: 'http://chat:8080',
    max_duration_s: 900,
    settings: { auth_server: 'http://[fd12:3456::1]:8080', refresh_cookie_name: 'production_rt' },
  });
});

it.each([900, 901])(
  'keeps all advanced values when only the name changes (duration %s seconds)',
  async (seconds) => {
    const target = {
      ...performanceTargets[0]!,
      max_duration_s: seconds,
      settings: { auth_server: 'https://login', refresh_cookie_name: 'production_rt' },
    };
    const view = open(list({ targets: [target] }), { write: () => response(target) });
    const user = userEvent.setup();
    await loaded();
    expect(row(target.id)).toHaveTextContent('Sign-in server');
    expect(row(target.id)).toHaveTextContent('https://login');
    expect(row(target.id)).toHaveTextContent('production_rt');
    await user.click(within(row(target.id)).getByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Advanced' })).toHaveAttribute('aria-expanded', 'true');
    expect(dialog.getByRole('textbox', { name: 'Sign-in server' })).toHaveValue('https://login');
    expect(dialog.getByRole('textbox', { name: 'Sign-in cookie name' })).toHaveValue('production_rt');
    await user.type(dialog.getByRole('textbox', { name: /^Name/ }), ' renamed');
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes(view.fetch)[0]?.[2]).toMatchObject({ settings: target.settings, max_duration_s: seconds });
  },
);

it('clears advanced overrides only when the person empties them', async () => {
  const target = {
    ...performanceTargets[0]!,
    max_duration_s: 900,
    settings: { auth_server: 'https://login', refresh_cookie_name: 'production_rt' },
  };
  const view = open(list({ targets: [target] }), { write: () => response(target) });
  const user = userEvent.setup();
  await loaded();
  await user.click(within(row(target.id)).getByRole('button', { name: 'Edit' }));
  const dialog = within(await screen.findByRole('dialog'));
  await user.clear(dialog.getByRole('textbox', { name: 'Sign-in server' }));
  await user.clear(dialog.getByRole('textbox', { name: 'Sign-in cookie name' }));
  await user.clear(dialog.getByRole('textbox', { name: 'Longest run, minutes' }));
  await user.click(dialog.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(view.fetch)[0]?.[2]).toMatchObject({
    settings: { auth_server: null, refresh_cookie_name: 'estishraf_rt' },
    max_duration_s: null,
  });
});

it.each([
  ['Address', 'base_url', 'http://chat/path', 'Enter the address without a path: scheme and host only'],
  ['Address', 'base_url', 'http://chat:0', 'Enter a port from 1 to 65535'],
  [
    'Sign-in server',
    'settings.auth_server',
    'http://metadata',
    "This is a link-local or cloud metadata address, not a system to test. Enter the target's own address",
  ],
])('shows the backend reason under %s without rewriting %s', async (label, field, address, message) => {
  const view = open(list(), {
    write: () =>
      refusal(422, 'validation_error', 'Invalid settings', [
        { loc: ['body', field], msg: message, type: 'value_error' },
      ]),
  });
  const user = userEvent.setup();
  await loaded();
  await user.click(within(row('target-preprod')).getByRole('button', { name: 'Edit' }));
  const dialog = within(await screen.findByRole('dialog'));
  const advanced = dialog.getByRole('button', { name: 'Advanced' });
  if (advanced.getAttribute('aria-expanded') === 'false') await user.click(advanced);
  const input = dialog.getByRole('textbox', { name: new RegExp(`^${label}`) });
  await user.clear(input);
  await user.type(input, address);
  await user.click(dialog.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(input).toHaveAccessibleDescription(expect.stringContaining(message)));
  expect(input).toHaveAttribute('aria-invalid', 'true');
  const body = writes(view.fetch)[0]?.[2] as Record<string, unknown>;
  expect(
    field === 'base_url' ? body?.base_url : (body?.settings as Record<string, unknown>).auth_server,
  ).toBe(address);
  await user.clear(input);
  expect(input).not.toHaveAttribute('aria-invalid', 'true');
});

it('shows an address conflict under Address in the backend’s own words', async () => {
  const message = 'The target "Playground 17" already uses this address.';
  open(list(), { write: () => refusal(409, 'target_address_taken', message, { name: 'Playground 17' }) });
  const user = userEvent.setup();
  await loaded();
  await user.click(within(row('target-preprod')).getByRole('button', { name: 'Edit' }));
  const dialog = within(await screen.findByRole('dialog'));
  const address = dialog.getByRole('textbox', { name: /^Address/ });
  await user.clear(address);
  await user.type(address, performanceTargets[0]!.base_url);
  await user.click(dialog.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(address).toHaveAccessibleDescription(expect.stringContaining(message)));
});
