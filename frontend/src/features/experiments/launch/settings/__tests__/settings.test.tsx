import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { LaunchTestProvider, useLaunch } from '../../LaunchContext';
import { createDocument, type LaunchDocument } from '../../model';
import { makeEnv, PRODUCTION, syntheticEntries } from '../../model/__fixtures__/fixtures';
import { SettingsSection } from '../../sections/SettingsSection';
import { SweepsSection } from '../../sections/SweepsSection';

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

function setup(ui: React.ReactElement, doc?: Partial<LaunchDocument>, mode?: 'launch' | 'editor') {
  const user = userEvent.setup();
  const utils = render(
    <LaunchTestProvider
      envs={envs}
      mode={mode}
      doc={createDocument({ environmentIds: [PRODUCTION], ...doc })}
    >
      {ui}
      <Probe />
    </LaunchTestProvider>,
  );
  return { user, ...utils };
}

const values = () => JSON.parse(screen.getByTestId('values').textContent ?? '{}') as Record<string, unknown>;

async function openGroup(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  const button = screen.getByRole('button', { name });
  if (button.getAttribute('aria-expanded') !== 'true') await user.click(button);
}

describe('SettingsSection', () => {
  it('shows closed groups, lazily', () => {
    setup(<SettingsSection />);
    expect(screen.getByRole('button', { name: /SQL runner/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Sql Result Limit')).not.toBeInTheDocument();
  });

  it('says the settings apply to the experiment in launch mode and to the default preset in the editor', () => {
    const launch = setup(<SettingsSection />);
    expect(screen.getByText(/applied to every run of this experiment/)).toBeInTheDocument();
    launch.unmount();
    setup(<SettingsSection />, undefined, 'editor');
    expect(screen.queryByText(/every run of this experiment/)).not.toBeInTheDocument();
    expect(screen.getByText(/saved in the default preset/)).toBeInTheDocument();
  });

  it('shows the raw setting key next to the label', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /SQL runner/);
    const field = screen
      .getByRole('textbox', { name: 'Sql Result Limit' })
      .closest('[data-field]') as HTMLElement;
    expect(within(field).getByText('SQL_RESULT_LIMIT')).toBeInTheDocument();
  });

  it('marks a changed leaf, writes it to the document and resets it', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /SQL runner/);
    const input = screen.getByRole('textbox', { name: 'Sql Result Limit' });
    await user.type(input, '500');
    await user.tab();
    expect(values()).toEqual({ '/SQL_RESULT_LIMIT': 500 });
    const field = input.closest('[data-field]') as HTMLElement;
    expect(within(field).getByText('changed')).toBeInTheDocument();
    expect(screen.getAllByText('1 changed').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Reset Sql Result Limit' }));
    expect(values()).toEqual({});
    expect(within(field).queryByText('changed')).not.toBeInTheDocument();
  });

  it('keeps text that is not a number and says so', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /SQL runner/);
    const input = screen.getByRole('textbox', { name: 'Sql Result Limit' });
    await user.type(input, 'abc');
    await user.tab();
    expect(values()).toEqual({});
    expect(screen.getByRole('textbox', { name: 'Sql Result Limit' })).toHaveValue('abc');
    expect(screen.getAllByText('Enter a number').length).toBeGreaterThan(0);
  });

  it('opens the matching group when searching', async () => {
    const { user } = setup(<SettingsSection />);
    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'request timeout');
    expect(screen.getByRole('button', { name: /Misc/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Request Timeout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /SQL runner/ })).not.toBeInTheDocument();
  });

  it('adds a key to a collection with Enter and shows "All endpoints"', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /LLM routing/);
    await user.type(screen.getByRole('textbox', { name: 'New endpoint name' }), 'fast{Enter}');
    expect(JSON.parse(screen.getByTestId('added').textContent ?? '{}')).toEqual({
      '/LLM_OVERRIDES/endpoints': ['fast'],
    });
    const table = screen.getByRole('table', { name: 'endpoint overrides' });
    expect(within(table).getByRole('rowheader', { name: 'fast' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'All endpoints' })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'All endpoints · Timeout' }), '30{Enter}');
    expect(values()).toMatchObject({
      '/LLM_OVERRIDES/endpoints/primary/timeout': 30,
      '/LLM_OVERRIDES/endpoints/fast/timeout': 30,
    });
  });

  it('writes the "All roles" row to every role', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /LLM routing/);
    await user.type(screen.getByRole('textbox', { name: 'All roles · max_tokens' }), '512{Enter}');
    const written = Object.entries(values()).filter(([p]) => p.endsWith('/max_tokens'));
    expect(written.length).toBeGreaterThanOrEqual(5);
    expect(written.map(([p]) => p)).toContain('/LLM_OVERRIDES/router/max_tokens');
    expect(written.every(([, v]) => v === 512)).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Reset roles' }));
    expect(values()).toEqual({});
  }, 20_000);

  it('sweeps the "All roles" row: a compact summary, chips in a popover, every role swept together', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /LLM routing/);
    await user.click(screen.getByRole('button', { name: 'Sweep values: All roles · max_tokens' }));
    const cell = document.querySelector('[data-global-sweep]') as HTMLElement;
    expect(cell).toBeInTheDocument();
    await user.click(within(cell).getByRole('button', { name: 'Edit sweep: All roles · max_tokens' }));
    const dialog = await screen.findByRole('dialog', { name: /Sweep values of/ });
    await user.type(within(dialog).getByRole('textbox'), '256, 512{Enter}');
    const swept = Object.entries(values()).filter(([p]) => p.endsWith('/max_tokens'));
    expect(swept.length).toBeGreaterThanOrEqual(5);
    expect(swept.every(([, v]) => JSON.stringify(v) === JSON.stringify({ sweep: [256, 512] }))).toBe(true);
    expect(cell).toHaveTextContent('sweeps 2 runs');
    expect(cell).toHaveTextContent('256 · 512');
    await user.click(within(dialog).getByRole('button', { name: /Single value/ }));
    expect(
      Object.entries(values())
        .filter(([p]) => p.endsWith('/max_tokens'))
        .every(([, v]) => v === 256),
    ).toBe(true);
  }, 20_000);

  it('narrows role rows with the role search', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /LLM routing/);
    await user.type(screen.getByRole('searchbox', { name: 'Search roles' }), 'router');
    const table = screen.getByRole('table', { name: 'role overrides' });
    expect(within(table).getByRole('rowheader', { name: /router/i })).toBeInTheDocument();
    expect(within(table).queryByRole('rowheader', { name: /brief/i })).not.toBeInTheDocument();
  });

  it('sweeps a value: a range adds five chips', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /Misc/);
    await user.click(screen.getByRole('button', { name: 'Sweep values: Request Timeout' }));
    expect(values()).toEqual({ '/REQUEST_TIMEOUT': { sweep: [] } });
    await user.click(screen.getByRole('button', { name: 'Range…' }));
    await user.type(screen.getByRole('textbox', { name: 'Start of the range for Request Timeout' }), '0.1');
    await user.type(screen.getByRole('textbox', { name: 'Stop of the range for Request Timeout' }), '0.5');
    await user.type(screen.getByRole('textbox', { name: 'Step of the range for Request Timeout' }), '0.1');
    await user.click(screen.getByRole('button', { name: 'Add range to Request Timeout' }));
    expect(values()).toEqual({ '/REQUEST_TIMEOUT': { sweep: [0.1, 0.2, 0.3, 0.4, 0.5] } });
    const chips = screen.getByRole('list', { name: 'Request Timeout values' });
    expect(within(chips).getAllByRole('listitem')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Remove 0.3 from Request Timeout' }));
    expect(within(chips).getAllByRole('listitem')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Single value for Request Timeout' }));
    expect(values()).toEqual({ '/REQUEST_TIMEOUT': 0.1 });
  });

  it('sweeps a boolean with both options', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /Feature toggles/);
    await user.click(screen.getByRole('button', { name: 'Sweep values: Enable Response Drafting' }));
    expect(values()).toEqual({ '/ENABLE_RESPONSE_DRAFTING': { sweep: [true, false] } });
    await user.click(screen.getByRole('button', { name: 'false' }));
    expect(values()).toEqual({ '/ENABLE_RESPONSE_DRAFTING': { sweep: [true] } });
  });

  it('offers no sweeps in the default preset editor (a default holds one configuration)', async () => {
    const { user } = setup(<SettingsSection />, undefined, 'editor');
    await openGroup(user, /Misc/);
    expect(screen.getByRole('textbox', { name: 'Request Timeout' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Sweep values/ })).not.toBeInTheDocument();
  });

  it('edits a value the widget cannot show as JSON', async () => {
    const { user } = setup(<SettingsSection />, { values: { '/REQUEST_TIMEOUT': { foo: 1 } } });
    await openGroup(user, /Misc/);
    const area = screen.getByRole('textbox', { name: 'Request Timeout' });
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).toHaveValue(JSON.stringify({ foo: 1 }, null, 2));
    expect(screen.getByText(/is not a number, so it is edited as JSON/)).toBeInTheDocument();
    await user.clear(area);
    await user.click(area);
    await user.paste('{"foo": 2}');
    await user.tab();
    expect(values()).toEqual({ '/REQUEST_TIMEOUT': { foo: 2 } });
  });

  it('has no accessibility violations', async () => {
    const { user, container } = setup(<SettingsSection />);
    await openGroup(user, /LLM routing/);
    await openGroup(user, /Feature toggles/);
    expect(await axe(container)).toHaveNoViolations();
  }, 60_000);
});

describe('SweepsSection', () => {
  const swept = {
    '/REQUEST_TIMEOUT': { sweep: [1, 2, 3] },
    '/SQL_RESULT_LIMIT': { sweep: [10, 20] },
  };

  it('shows the run maths and the axes', () => {
    setup(<SweepsSection />, { values: swept });
    expect(screen.getByTestId('sweep-math')).toHaveTextContent(
      '3 × 2 = 6 combinations × 1 environment = 6 runs',
    );
    expect(screen.getByRole('list', { name: 'Sweep axes' }).children).toHaveLength(2);
    expect(screen.getByText('× 3')).toBeInTheDocument();
  });

  it('refuses to link axes of different lengths and links equal ones', async () => {
    const { user } = setup(<SweepsSection />, { values: swept });
    await user.click(screen.getByRole('checkbox', { name: 'Select Request Timeout to link' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Sql Result Limit to link' }));
    await user.click(screen.getByRole('button', { name: 'Link selected' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Linked values need the same number of values/);
    expect(screen.getByTestId('links')).toHaveTextContent('null');
    // make them equal: add a value to the shorter axis
    await user.type(screen.getByRole('textbox', { name: 'Add values to Sql Result Limit' }), '30{Enter}');
    await user.click(screen.getByRole('button', { name: 'Link selected' }));
    expect(JSON.parse(screen.getByTestId('links').textContent ?? 'null')).toEqual([
      ['/env_overrides/REQUEST_TIMEOUT', '/env_overrides/SQL_RESULT_LIMIT'],
    ]);
    expect(screen.getByTestId('sweep-math')).toHaveTextContent('3 = 3 combinations');
    await user.click(screen.getByRole('button', { name: /Unlink/ }));
    expect(screen.getByTestId('links')).toHaveTextContent('null');
  });

  it('flags a sweep over the run limit', () => {
    const many = { '/REQUEST_TIMEOUT': { sweep: Array.from({ length: 11 }, (_, i) => i + 1) } };
    render(
      <LaunchTestProvider
        envs={[makeEnv(PRODUCTION, 'production')]}
        doc={createDocument({ environmentIds: [PRODUCTION], values: many })}
        preview={{ data: { job_count: 11, max_jobs: 10 } as never }}
      >
        <SweepsSection />
      </LaunchTestProvider>,
    );
    expect(screen.getByText(/11 runs is over the limit of 10/)).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = setup(<SweepsSection />, { values: swept });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('structured JSON editor and open objects', () => {
  const synthetic = [
    makeEnv(PRODUCTION, 'production', {
      add: syntheticEntries.map((e) => ({ entry: e, group: 'misc', root: !e.parent })),
    }),
  ];
  function setupSynthetic(doc: Partial<LaunchDocument>) {
    const user = userEvent.setup();
    render(
      <LaunchTestProvider envs={synthetic} doc={createDocument({ environmentIds: [PRODUCTION], ...doc })}>
        <SettingsSection />
        <Probe />
      </LaunchTestProvider>,
    );
    return user;
  }

  it('edits a list of scalars with an "All" input and add/remove', async () => {
    const user = setupSynthetic({ values: { '/STOP_WORDS': ['a', 'b'] } });
    await openGroup(user, /Misc/);
    await user.type(screen.getByRole('textbox', { name: 'STOP_WORDS · 0' }), 'x');
    expect(values()['/STOP_WORDS']).toEqual(['ax', 'b']);
    await user.type(screen.getByRole('textbox', { name: 'STOP_WORDS · * (all items)' }), 'z{Enter}');
    expect(values()['/STOP_WORDS']).toEqual(['z', 'z']);
    await user.click(screen.getByRole('button', { name: /Add item/ }));
    expect(values()['/STOP_WORDS']).toEqual(['z', 'z', '']);
    await user.click(screen.getByRole('button', { name: 'Remove item 1 of STOP_WORDS' }));
    expect(values()['/STOP_WORDS']).toEqual(['z', '']);
  });

  it('"Edit as fields" on an unset list changes nothing until the first edit', async () => {
    const user = setupSynthetic({});
    await openGroup(user, /Misc/);
    await user.click(screen.getByRole('button', { name: 'Edit STOP_WORDS as fields' }));
    expect(values()).toEqual({});
    await user.click(screen.getByRole('button', { name: /Add item/ }));
    expect(values()['/STOP_WORDS']).toEqual(['']);
  });

  it('shows same-key objects as a table with an "All items" row', async () => {
    const user = setupSynthetic({ values: { '/STOP_WORDS': [{ n: 1 }, { n: 2 }] } });
    await openGroup(user, /Misc/);
    await user.type(screen.getByRole('textbox', { name: 'STOP_WORDS · * · n (all items)' }), '7{Enter}');
    expect(values()['/STOP_WORDS']).toEqual([{ n: 7 }, { n: 7 }]);
  });

  it('adds and removes the extra keys of an open object', async () => {
    const user = setupSynthetic({});
    await openGroup(user, /Misc/);
    await user.type(screen.getByRole('textbox', { name: 'New key' }), 'foo{Enter}');
    expect(screen.getByRole('textbox', { name: /foo/ })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /foo/ }), '3');
    await user.tab();
    expect(values()['/EXTRA/foo']).toBe(3);
    await user.click(screen.getByRole('button', { name: /Remove .*foo/ }));
    expect(values()['/EXTRA/foo']).toBeUndefined();
  });
});
