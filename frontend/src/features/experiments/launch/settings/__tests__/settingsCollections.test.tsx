import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsSection } from '../../sections/SettingsSection';
import { openGroup, setup, SLOW_FORM, values } from './settingsHarness';

describe('SettingsSection: collections and role search', SLOW_FORM, () => {
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

  it('narrows role rows with the role search', async () => {
    const { user } = setup(<SettingsSection />);
    await openGroup(user, /LLM routing/);
    await user.type(screen.getByRole('searchbox', { name: 'Search roles' }), 'router');
    const table = screen.getByRole('table', { name: 'role overrides' });
    expect(within(table).getByRole('rowheader', { name: /router/i })).toBeInTheDocument();
    expect(within(table).queryByRole('rowheader', { name: /brief/i })).not.toBeInTheDocument();
  });
});
