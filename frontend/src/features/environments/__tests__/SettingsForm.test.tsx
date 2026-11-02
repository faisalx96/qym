import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EvalEnvironment } from '@/api/evalCommon';
import { ToastProvider } from '@/ui';

const update = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));

vi.mock('@/api/evalEnvironments', () => ({
  useUpdateEnvironment: () => update,
  useDeleteEnvironment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SettingsForm } from '../SettingsForm';

const env = {
  id: 'e1',
  project_id: 'p1',
  name: 'staging',
  description: '',
  base_url: 'https://eval.example.com/prefix',
  api_key_set: true,
  api_key_hint: '••••9876',
  default_priority: 'NORMAL',
  max_priority: 'NORMAL',
  latency_sensitive_min_role: 'member',
  allow_connection_keys: false,
  ranking_metric: null,
  ranking_k: null,
} as unknown as EvalEnvironment;

function renderForm() {
  update.mutateAsync.mockReset();
  update.mutateAsync.mockResolvedValue(env);
  render(
    <ToastProvider>
      <SettingsForm projectId="p1" env={env} canEdit onDeleted={() => {}} />
    </ToastProvider>,
  );
  return {
    baseUrl: screen.getByRole('textbox', { name: 'Base URL' }),
    key: screen.getByLabelText(/API key/),
    save: screen.getByRole('button', { name: 'Save changes' }),
  };
}

describe('environment settings: the stored key stays with its host (C004)', () => {
  it('keeps the stored key for a new path on the same host', async () => {
    const { baseUrl, key, save } = renderForm();
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, 'https://eval.example.com/v2');
    expect(key).toHaveAttribute('placeholder', 'Leave blank to keep ••••9876');
    await userEvent.click(save);
    expect(update.mutateAsync).toHaveBeenCalledTimes(1);
    expect(update.mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty('api_key');
  });

  it('asks for the key again and does not save a new host without it', async () => {
    const { baseUrl, key, save } = renderForm();
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, 'https://attacker.example.com');
    expect(key).toHaveAttribute('placeholder', 'Enter the key for the new host');
    expect(key).toBeRequired();

    await userEvent.click(save);
    expect(update.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('Enter the API key again for the new host.')).toBeInTheDocument();

    await userEvent.type(key, 'new-host-key');
    await userEvent.click(save);
    expect(update.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ base_url: 'https://attacker.example.com', api_key: 'new-host-key' }),
    );
  });
});
