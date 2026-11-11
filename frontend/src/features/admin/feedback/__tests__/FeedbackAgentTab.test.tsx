import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentAdmin } from '@/api/feedback';
import { ToastProvider } from '@/ui';

const save = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const data: AgentAdmin = {
  configured: true,
  encryption_ready: true,
  connection: {
    llm_base_url: 'https://llm.example.com/v1',
    llm_model: 'gpt-4.1',
    llm_api_key_set: true,
    llm_api_key_hint: '••••1234',
  },
  behaviour: { draft_retention_days: 30, max_user_messages: 12 },
  last_test: { at: null, ok: null, detail: null },
  counts: { requests: 0, new: 0, open_drafts: 0, assistant_calls_7d: 0 },
  updated_at: null,
};

vi.mock('@/api/feedback', () => ({
  useAgentAdmin: () => ({ data, isError: false }),
  useSaveAgent: () => save,
  useTestAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveAgent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { FeedbackAgentTab } from '../FeedbackAgentTab';

function renderTab() {
  render(
    <ToastProvider>
      <FeedbackAgentTab />
    </ToastProvider>,
  );
  return {
    baseUrl: screen.getByRole('textbox', { name: /Base URL/ }),
    key: screen.getByLabelText(/API key/),
    save: screen.getByRole('button', { name: 'Save connection' }),
    test: screen.getByRole('button', { name: 'Test connection' }),
  };
}

describe('feedback agent connection: the stored key stays with its host (C004)', () => {
  it('keeps the stored key for a new path on the same host', async () => {
    const { baseUrl, key, save: saveButton } = renderTab();
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, 'https://llm.example.com/v2');
    expect(key).toHaveAttribute('placeholder', 'Keep current (••••1234)');
    expect(saveButton).toBeEnabled();
  });

  it('asks for the key again before it saves or tests another host', async () => {
    const { baseUrl, key, save: saveButton, test } = renderTab();
    await userEvent.clear(baseUrl);
    await userEvent.type(baseUrl, 'https://attacker.example.com/v1');
    expect(key).toHaveAttribute('placeholder', 'Enter the key for the new host');
    expect(key).toBeRequired();
    expect(saveButton).toBeDisabled();
    expect(test).toBeDisabled();

    await userEvent.type(key, 'sk-new-host');
    expect(saveButton).toBeEnabled();
    await userEvent.click(saveButton);
    expect(save.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_base_url: 'https://attacker.example.com/v1',
        llm_api_key: 'sk-new-host',
      }),
    );
  });
});

describe('feedback assistant tab (C244)', () => {
  it('opens with one titled Section whose description holds the totals, with no second stat strip', () => {
    renderTab();
    expect(screen.getByRole('heading', { name: 'Feedback assistant' })).toBeInTheDocument();
    expect(
      screen.getByText(
        '0 requests, 0 new · 0 open drafts, deleted after 30 days · 0 assistant calls in 7 days',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Feedback totals')).toBeNull();
  });
});
