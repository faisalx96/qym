import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsSection } from '../../sections/SettingsSection';
import { openGroup, setup, SLOW_FORM, values } from './settingsHarness';

describe('SettingsSection: All roles sweep', SLOW_FORM, () => {
  it('sweeps the "All roles" row: a compact summary, chips in a popover, every role swept together', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /LLM routing/);
    await user.click(screen.getByRole('button', { name: 'Sweep values: All roles · max_tokens' }));
    const cell = document.querySelector('[data-global-sweep]') as HTMLElement;
    expect(cell).toBeInTheDocument();
    await user.click(within(cell).getByRole('button', { name: /edit sweep: All roles · max_tokens/ }));
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
  });
});
