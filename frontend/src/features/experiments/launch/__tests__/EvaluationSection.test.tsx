import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it } from 'vitest';
import { EvaluationSection } from '../sections/EvaluationSection';
import { createDocument } from '../model';
import { live, makeCtx, makeEnv, PRODUCTION, renderSection } from './sectionTestKit';

function setup(extra: Record<string, unknown> = {}) {
  const env = makeEnv(PRODUCTION, 'production');
  const doc = createDocument({ environmentIds: [PRODUCTION], evaluatorExtra: extra as never });
  return renderSection(<EvaluationSection />, {
    envs: [env],
    doc,
    overrides: { ctx: makeCtx({ envs: [env] }) },
  });
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Evaluation configurations/ }));
}

describe('EvaluationSection', () => {
  it('generates the evaluation inputs and writes edits on top of the base', async () => {
    const user = userEvent.setup();
    setup({ config: { samples: 2 } });
    await open(user);
    const field = document.querySelector('[data-eval-field="samples"]') as HTMLElement;
    expect(field).toBeInTheDocument();
    const input = within(field).getByRole('textbox', { name: 'Samples' });
    expect(input).toHaveValue('2');
    await user.clear(input);
    await user.type(input, '7');
    expect(live.current?.doc.evaluator.config['samples']).toBe(7);
    expect(within(field).getByText('Changed from the starting point')).toBeInTheDocument();
    await user.click(within(field).getByRole('button', { name: /Reset Samples/ }));
    expect(live.current?.doc.evaluator.config['samples']).toBeUndefined();
    expect(screen.queryByText('Changed from the starting point')).not.toBeInTheDocument();
  });

  it('keeps what the user typed while typing a decimal', async () => {
    const user = userEvent.setup();
    setup();
    await open(user);
    const field = document.querySelector('[data-eval-field="timeout"]') as HTMLElement;
    const input = within(field).getByRole('textbox', { name: 'Timeout' });
    await user.type(input, '1.');
    expect(input).toHaveValue('1.');
    await user.type(input, '5');
    expect(live.current?.doc.evaluator.config['timeout']).toBe(1.5);
  });

  it('marks a reserved run-metadata key and a duplicate', async () => {
    const user = userEvent.setup();
    setup();
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Add key' }));
    await user.type(screen.getByRole('textbox', { name: 'Metadata key 1' }), 'qym_secret');
    await user.type(screen.getByRole('textbox', { name: 'Metadata value 1' }), 'x');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Keys starting with qym_ are reserved/);
    expect(
      live.current?.review.items.some((i) => i.message.includes('reserved for the platform')),
    ).toBe(true);

    await user.clear(screen.getByRole('textbox', { name: 'Metadata key 1' }));
    await user.type(screen.getByRole('textbox', { name: 'Metadata key 1' }), 'ticket');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add key' }));
    await user.type(screen.getByRole('textbox', { name: 'Metadata key 2' }), 'ticket');
    expect(await screen.findByRole('alert')).toHaveTextContent('Duplicate key');
    await user.click(screen.getAllByRole('button', { name: /Remove metadata key/ })[1]!);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows reserved base keys read-only, the also-sent keys and the platform-owned list', async () => {
    const user = userEvent.setup();
    setup({ report_k: 3, config: { run_metadata: { qym_launch: 'abc', team: 'a' } } });
    await open(user);
    const reserved = document.querySelector('[data-reserved-key="qym_launch"]') as HTMLElement;
    expect(reserved).toBeInTheDocument();
    expect(within(reserved).queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Metadata key 1' })).toHaveValue('team');
    const also = document.querySelector('[data-also-sent]') as HTMLElement;
    expect(within(also).getByText(/report_k = 3/)).toBeInTheDocument();
    await user.click(within(also).getByRole('button', { name: 'Stop sending report_k' }));
    expect(document.querySelector('[data-also-sent]')).not.toBeInTheDocument();
    const owned = screen.getByRole('region', { name: 'Set by the platform' });
    expect(within(owned).getByText('run_name')).toBeInTheDocument();
    expect(within(owned).getByText('qym_config')).toBeInTheDocument();
  });

  it('shows config values no field describes as editable JSON', async () => {
    const user = userEvent.setup();
    setup({ config: { custom_flag: { a: 1 } } });
    await open(user);
    const other = screen.getByRole('region', { name: 'Other values' });
    expect(within(other).getByRole('textbox', { name: 'custom_flag' })).toHaveValue(
      JSON.stringify({ a: 1 }, null, 2),
    );
    await user.click(within(other).getByRole('button', { name: 'Remove custom_flag' }));
    expect(live.current?.doc.evaluator.config['custom_flag']).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const user = userEvent.setup();
    const { container } = setup({ report_k: 3, config: { run_metadata: { qym_launch: 'abc' }, custom_flag: 1 } });
    await open(user);
    await user.click(screen.getByRole('button', { name: 'Add key' }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
