import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LlmConnection } from '@/api/types';
import { ConnectionForm } from '../LlmConnectionsTab';

const saved: LlmConnection = {
  id: 'c1',
  project_id: 'p1',
  name: 'OpenAI prod',
  llm_base_url: 'https://api.provider.example/v1',
  llm_model: 'gpt-4.1',
  llm_api_key_set: true,
  llm_api_key_hint: '••••1234',
  is_default: true,
  available_for_experiments: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

function renderForm() {
  const onSubmit = vi.fn();
  render(<ConnectionForm initial={saved} busy={false} onCancel={() => {}} onSubmit={onSubmit} />);
  return {
    onSubmit,
    baseUrl: screen.getByRole('textbox', { name: /Base URL/ }),
    key: screen.getByLabelText(/API key/),
    save: screen.getByRole('button', { name: 'Save changes' }),
  };
}

describe('LLM connection form: the stored key stays with its host (C004)', () => {
  it('keeps the stored key while the host is the same', async () => {
    const { onSubmit, baseUrl, key, save } = renderForm();
    expect(key).toHaveAttribute('placeholder', 'Keep current (••••1234)');
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, 'https://api.provider.example/v2');
    expect(key).toHaveAttribute('placeholder', 'Keep current (••••1234)');
    await userEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ llm_api_key: '__KEEP__' }));
  });

  it('asks for the key again once the base URL points to another host', async () => {
    const { onSubmit, baseUrl, key, save } = renderForm();
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, 'https://attacker.example/v1');
    expect(key).toHaveAttribute('placeholder', 'Enter the key for the new host');
    expect(key).toBeRequired();
    expect(save).toBeDisabled();

    await userEvent.type(key, 'sk-new-host');
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ llm_base_url: 'https://attacker.example/v1', llm_api_key: 'sk-new-host' }),
    );
  });
});
