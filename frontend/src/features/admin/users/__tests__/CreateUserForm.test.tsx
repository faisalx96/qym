import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';

const create = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock('@/api/admin', () => ({ useCreateUser: () => create }));

import { CreateUserForm } from '../CreateUserForm';

function renderForm(props: Parameters<typeof CreateUserForm>[0] = {}) {
  render(
    <ToastProvider>
      <CreateUserForm {...props} />
    </ToastProvider>,
  );
  return {
    email: screen.getByRole('textbox', { name: /Email/ }),
    submit: screen.getByRole('button', { name: 'Create user' }),
  };
}

describe('Create user (M2)', () => {
  it("shows the app's email message on the line under the bar, not the browser's (C243)", async () => {
    const { email, submit } = renderForm();
    await userEvent.type(email, 'not-an-email');
    await userEvent.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(create.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows the one-time password once with Copy, and reports the new id (C131, C227)', async () => {
    create.mutateAsync.mockResolvedValueOnce({
      id: 'u9',
      email: 'new@example.test',
      temporary_password: 'Temp-pass-123456',
    });
    const onCreated = vi.fn();
    const { email, submit } = renderForm({ onCreated, localAuth: true });
    await userEvent.type(email, 'new@example.test');
    await userEvent.click(submit);
    expect(await screen.findByText('User new@example.test created. One-time password:')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Temp-pass-123456')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy one-time password' })).toBeInTheDocument();
    expect(
      screen.getByText('They set a new password at first sign-in. It is not shown again.'),
    ).toBeInTheDocument();
    expect(onCreated).toHaveBeenCalledWith('u9', false);
  });

  it('says which provider the new user signs in with when password sign-in is off (C131)', async () => {
    create.mutateAsync.mockResolvedValueOnce({ id: 'u8', email: 'sso@example.test' });
    const { email, submit } = renderForm({ localAuth: false, providers: ['GitLab'] });
    await userEvent.type(email, 'sso@example.test');
    await userEvent.click(submit);
    expect(
      await screen.findByText('User sso@example.test created. They sign in with GitLab.'),
    ).toBeInTheDocument();
  });
});
