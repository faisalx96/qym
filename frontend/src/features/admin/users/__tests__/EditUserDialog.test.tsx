import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';
import type { AdminUser } from '@/api/admin';
import { EditUserDialog } from '../EditUserDialog';

const user = {
  id: 'u1',
  email: 'reset@example.test',
  display_name: 'Reset Me',
  role: 'MEMBER',
  is_active: true,
} as AdminUser;

function open(localAuth: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <EditUserDialog user={user} open onOpenChange={vi.fn()} meId="admin" localAuth={localAuth} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('EditUserDialog password reset', () => {
  it('warns that the user is signed out of every browser before resetting', async () => {
    open(true);
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Reset password' });
    expect(confirm).toHaveTextContent('They are signed out of every browser.');
    expect(confirm).toHaveTextContent('reset@example.test');
    expect(screen.getByText(/Signs them out everywhere/)).toBeInTheDocument();
  });

  it('offers no reset without local password auth', () => {
    open(false);
    expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  });
});
