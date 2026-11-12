// Shared setup for the SettingsSection test files (split so the slow form tests run in parallel).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { LaunchTestProvider, useLaunch } from '../../LaunchContext';
import { createDocument, type LaunchDocument } from '../../model';
import { makeEnv, PRODUCTION } from '../../model/__fixtures__/fixtures';

function Probe() {
  const { doc } = useLaunch();
  return (
    <>
      <pre data-testid="values">{JSON.stringify(doc.values)}</pre>
      <pre data-testid="added">{JSON.stringify(doc.addedKeys)}</pre>
      <pre data-testid="links">{JSON.stringify(doc.links ?? null)}</pre>
    </>
  );
}

const envs = [makeEnv(PRODUCTION, 'production')];
type EvalEnvironmentForm = (typeof envs)[number];

export function setup(
  ui: ReactElement,
  doc?: Partial<LaunchDocument>,
  mode?: 'launch' | 'editor',
  environments: EvalEnvironmentForm[] = envs,
) {
  const user = userEvent.setup();
  const utils = render(
    <LaunchTestProvider
      envs={environments}
      mode={mode}
      doc={createDocument({ environmentIds: [PRODUCTION], ...doc })}
    >
      {ui}
      <Probe />
    </LaunchTestProvider>,
  );
  return { user, ...utils };
}

export const values = () =>
  JSON.parse(screen.getByTestId('values').textContent ?? '{}') as Record<string, unknown>;

export async function openGroup(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const button = screen.getByRole('button', { name });
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button);
}

// Every leaf is a ui Select, TextField or Textarea (E-25), so this form renders slowly in jsdom: 4-20 s per test
// locally and 2-4 times that on the CI runner. A timed-out test also leaves a half-typed value for the next one.
export const SLOW_FORM = { timeout: 120_000 };
