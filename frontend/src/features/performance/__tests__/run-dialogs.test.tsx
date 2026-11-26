import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { performanceRunRunning, performanceRunTokenNeeded } from '@/features/dev/performanceFixtures';
import { refusal, response, setup, writes } from './runHarness';

// The two dialogs of the run page: the question before a stop, and the hand-off of a new token.
const TOKEN = 'qa-refresh-7f3c9d21e8b4a650';

/**
 * True when any component under `container` holds `needle`: in a hook's state or ref, or in the props it was
 * given. A walk over React's own tree, so a value kept in state that is not on screen is found too.
 */
function heldByComponents(container: HTMLElement, needle: string): boolean {
  const key = Object.keys(container).find((name) => name.startsWith('__reactContainer$'));
  if (!key) throw new Error('no React tree under the container');
  const seen = new WeakSet<object>();
  const holds = (value: unknown, depth: number): boolean => {
    if (typeof value === 'string') return value.includes(needle);
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return false;
    seen.add(value);
    // Elements are looked at on their own fibers; DOM nodes are looked at through the page's text.
    if ('$$typeof' in value || value instanceof Node) return false;
    return Object.values(value).some((item) => holds(item, depth + 1));
  };
  interface Fiber {
    child: Fiber | null;
    sibling: Fiber | null;
    memoizedProps: unknown;
    memoizedState: unknown;
  }
  const stack: (Fiber | null)[] = [(container as unknown as Record<string, Fiber>)[key]!];
  while (stack.length) {
    const fiber = stack.pop();
    if (!fiber) continue;
    if (holds(fiber.memoizedProps, 0)) return true;
    let hook = fiber.memoizedState as { memoizedState?: unknown; next?: unknown } | null;
    if (hook && typeof hook === 'object' && 'next' in hook) {
      for (; hook; hook = (hook.next ?? null) as typeof hook) if (holds(hook.memoizedState, 0)) return true;
    } else if (holds(fiber.memoizedState, 0)) return true;
    stack.push(fiber.child, fiber.sibling);
  }
  return false;
}

/** Everything the page keeps outside its components: the reads and the writes of the query client. */
const heldByClient = (client: ReturnType<typeof setup>['client'], needle: string) =>
  JSON.stringify([
    client
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    client
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
  ]).includes(needle);

it('stops a run with the reason given, after saying what stops and what is kept', async () => {
  const user = userEvent.setup();
  const { fetch, runId } = setup(performanceRunRunning, {
    server: { write: () => response({ run_id: performanceRunRunning.run.id, status: 'stopping' }) },
  });
  await user.click(await screen.findByRole('button', { name: 'Stop run' }));
  const dialog = await screen.findByRole('dialog', { name: 'Stop this run?' });
  expect(dialog).toHaveTextContent('Run 24 is 21m 30s in and is measuring 30 users.');
  expect(dialog).toHaveTextContent('The level in progress will say how much of its hold ran.');
  expect(within(dialog).getByRole('button', { name: 'Keep running' })).toBeInTheDocument();

  await user.type(
    within(dialog).getByRole('textbox', { name: /Reason/ }),
    '  Preprod is needed for a demo. ',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Stop run' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(fetch)).toEqual([
    [`/api/projects/demo/performance/runs/${runId}/stop`, { reason: 'Preprod is needed for a demo.' }],
  ]);
});

it('stops without a reason when none is given', async () => {
  const user = userEvent.setup();
  const { fetch } = setup(performanceRunRunning, { initial: { dialog: 'stop' } });
  const dialog = await screen.findByRole('dialog', { name: 'Stop this run?' });
  await user.click(within(dialog).getByRole('button', { name: 'Stop run' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(fetch).map(([, body]) => body)).toEqual([{}]);
});

it('keeps the stop question open with the words of a refused stop', async () => {
  const user = userEvent.setup();
  setup(performanceRunRunning, {
    initial: { dialog: 'stop' },
    server: { write: () => refusal(403, 'forbidden', 'Only members of the project can stop a run.') },
  });
  const dialog = await screen.findByRole('dialog', { name: 'Stop this run?' });
  await user.click(within(dialog).getByRole('button', { name: 'Stop run' }));
  expect(await within(dialog).findByText('Only members of the project can stop a run.')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Stop this run?' })).toBeInTheDocument();
});

it('hands a new token to the run and keeps no trace of it once the dialog closes', async () => {
  const user = userEvent.setup();
  const { fetch, client, container, runId } = setup(performanceRunTokenNeeded, {
    server: { write: () => response({ name: 'refresh_token', hint: '0a65', version: 2 }) },
  });
  await user.click(await screen.findByRole('button', { name: 'Send a new token' }));
  const dialog = await screen.findByRole('dialog', { name: 'Send a new refresh token' });
  const field = within(dialog).getByLabelText(/New refresh token/);
  expect(field).toHaveAttribute('type', 'password');
  expect(dialog).toHaveTextContent('the value of estishraf_rt');

  await user.type(field, TOKEN);
  // While the dialog is open the field holds it: the walk below finds a held value when there is one.
  expect(heldByComponents(container, TOKEN)).toBe(true);
  await user.click(within(dialog).getByRole('button', { name: 'Send token' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(writes(fetch)).toEqual([
    [`/api/projects/demo/performance/runs/${runId}/tokens`, { name: 'refresh_token', token: TOKEN }],
  ]);

  expect(document.body.innerHTML).not.toContain(TOKEN);
  expect(heldByComponents(container, TOKEN)).toBe(false);
  expect(heldByClient(client, TOKEN)).toBe(false);
  // Opened again, the dialog starts empty.
  await user.click(screen.getByRole('button', { name: 'Send a new token' }));
  const again = await screen.findByRole('dialog', { name: 'Send a new refresh token' });
  expect(within(again).getByLabelText(/New refresh token/)).toHaveValue('');
});

it('shows the words of a refused hand-off, and forgets the token when the person gives up', async () => {
  const user = userEvent.setup();
  const { client, container } = setup(performanceRunTokenNeeded, {
    initial: { dialog: 'token' },
    server: {
      write: () =>
        refusal(409, 'run_ended', 'This run has ended. A new token is no longer needed.', {
          status: 'stopped',
        }),
    },
  });
  const dialog = await screen.findByRole('dialog', { name: 'Send a new refresh token' });
  await user.type(within(dialog).getByLabelText(/New refresh token/), TOKEN);
  await user.click(within(dialog).getByRole('button', { name: 'Send token' }));
  expect(
    await within(dialog).findByText('This run has ended. A new token is no longer needed.'),
  ).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.body.innerHTML).not.toContain(TOKEN);
  expect(heldByComponents(container, TOKEN)).toBe(false);
  expect(heldByClient(client, TOKEN)).toBe(false);
});

it('asks for a token before it is sent, and sends nothing for an empty field', async () => {
  const user = userEvent.setup();
  const { fetch } = setup(performanceRunTokenNeeded, { initial: { dialog: 'token' } });
  const dialog = await screen.findByRole('dialog', { name: 'Send a new refresh token' });
  await user.type(within(dialog).getByLabelText(/New refresh token/), '   ');
  await user.click(within(dialog).getByRole('button', { name: 'Send token' }));
  expect(await within(dialog).findByText('New refresh token is required.')).toBeInTheDocument();
  expect(writes(fetch)).toEqual([]);
});
