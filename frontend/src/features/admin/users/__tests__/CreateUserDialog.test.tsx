import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { ToastProvider } from '@/ui';

const create = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
vi.mock('@/api/admin', () => ({ useCreateUser: () => create }));

import { CreateUserDialog, type CreateUserDialogProps } from '../CreateUserDialog';

function renderDialog(props: Partial<CreateUserDialogProps> = {}) {
  const onOpenChange = vi.fn();
  render(
    <ToastProvider>
      <CreateUserDialog open onOpenChange={onOpenChange} {...props} />
    </ToastProvider>,
  );
  return {
    onOpenChange,
    email: screen.getByRole('textbox', { name: /Email/ }),
    submit: screen.getByRole('button', { name: 'Create user' }),
  };
}

describe('Create user dialog (cv4 A2)', () => {
  beforeEach(() => create.mutateAsync.mockReset());

  it('focuses the email field first and offers Member and Admin roles', async () => {
    const { email } = renderDialog();
    await vi.waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Display name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Role/ })).toHaveTextContent('Member');
  });

  it('requires an email and checks it in the app, not the browser (C243)', async () => {
    const { email, submit, onOpenChange } = renderDialog();
    await userEvent.click(submit);
    expect(await screen.findByText('Email is required.')).toBeInTheDocument();
    await userEvent.type(email, 'not-an-email');
    await userEvent.click(submit);
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(create.mutateAsync).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('shows the API error and stays open', async () => {
    create.mutateAsync.mockRejectedValueOnce(new ApiError(409, 'Email is taken by a disabled user.'));
    const { email, submit, onOpenChange } = renderDialog();
    await userEvent.type(email, 'x@example.test');
    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Email is taken by a disabled user.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('sends the role, closes on success and passes the one-time password on (C131, C227)', async () => {
    create.mutateAsync.mockResolvedValueOnce({
      id: 'u9',
      email: 'new@example.test',
      temporary_password: 'Temp-pass-123456',
    });
    const onCreated = vi.fn();
    const onSecret = vi.fn();
    const { email, submit, onOpenChange } = renderDialog({ onCreated, onSecret, localAuth: true });
    await userEvent.type(email, 'new@example.test');
    await userEvent.click(screen.getByRole('button', { name: /Role/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));
    await userEvent.click(submit);
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(create.mutateAsync).toHaveBeenCalledWith({
      email: 'new@example.test',
      display_name: undefined,
      role: 'ADMIN',
    });
    expect(onSecret).toHaveBeenCalledWith({ email: 'new@example.test', password: 'Temp-pass-123456' });
    expect(onCreated).toHaveBeenCalledWith('u9', false);
  });

  it('says which provider the new user signs in with when password sign-in is off (C131)', async () => {
    create.mutateAsync.mockResolvedValueOnce({ id: 'u8', email: 'sso@example.test' });
    const { email, submit } = renderDialog({ localAuth: false, providers: ['GitLab'] });
    await userEvent.type(email, 'sso@example.test');
    await userEvent.click(submit);
    expect(
      await screen.findByText('User sso@example.test created. They sign in with GitLab.'),
    ).toBeInTheDocument();
  });
});
