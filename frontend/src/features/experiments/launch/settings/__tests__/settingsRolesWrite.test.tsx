import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsSection } from '../../sections/SettingsSection';
import { openGroup, setup, SLOW_FORM, values } from './settingsHarness';

describe('SettingsSection: All roles value', SLOW_FORM, () => {
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
  });
});
