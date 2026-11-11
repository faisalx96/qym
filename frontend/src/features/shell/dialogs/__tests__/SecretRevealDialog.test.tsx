import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';
import { SecretRevealDialog } from '../SecretRevealDialog';

function open(onClose = vi.fn()) {
  render(
    <ToastProvider>
      <SecretRevealDialog open onClose={onClose} title="API key created" secret="qym_secret" noun="API key" />
    </ToastProvider>,
  );
  return onClose;
}

describe('SecretRevealDialog (C045)', () => {
  it('Escape does not close it, so the one-time secret is not lost', async () => {
    const onClose = open();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('qym_secret')).toBeInTheDocument();
  });

  it('a click on the backdrop does not close it', () => {
    const onClose = open();
    const backdrop = document.querySelector('[class*="backdrop"]');
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop!);
    fireEvent.pointerUp(backdrop!);
    fireEvent.click(backdrop!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Done closes it', async () => {
    const onClose = open();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
