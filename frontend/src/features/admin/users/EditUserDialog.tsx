import { useRef, useState } from 'react';
import { useResetPassword, useUpdateUser, type AdminUser, type UpdateUserBody } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { Button, Checkbox, ConfirmDialog, CopyButton, Dialog, Select, Text, TextField, useToast } from '@/ui';
import { isValidEmail } from '../format';
import styles from './users.module.css';

export interface EditUserDialogProps {
  user: AdminUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The signed-in admin (role/active lock on their own row). */
  meId: string;
  /** Local password auth enabled → reset password available. */
  localAuth: boolean;
}

function errorText(e: unknown): string {
  return e instanceof ApiError ? e.detail || `HTTP ${e.status}` : e instanceof Error ? e.message : String(e);
}

/**
 * Edit user: email, display name, role, active; self-edit locks role + active
 * and omits them from the PUT. Reset password (local auth, not self) shows the
 * one-time password inline. While a save/reset is pending every control locks
 * and the dialog cannot close; the temporary password is cleared on close.
 */
export function EditUserDialog(props: EditUserDialogProps) {
  // Remount per user/open so field state resets without effects.
  return props.open && props.user ? <EditUserDialogInner key={props.user.id} {...props} user={props.user} /> : null;
}

function EditUserDialogInner({ user, open, onOpenChange, meId, localAuth }: EditUserDialogProps & { user: AdminUser }) {
  const isSelf = user.id === meId;
  const [email, setEmail] = useState(user.email);
  const [name, setName] = useState(user.display_name ?? '');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>(user.role === 'ADMIN' ? 'ADMIN' : 'MEMBER');
  const [active, setActive] = useState(user.is_active);
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const update = useUpdateUser();
  const reset = useResetPassword();
  const toast = useToast();
  const busy = update.isPending || reset.isPending;

  function close() {
    if (busy) return;
    setTemp(null);
    onOpenChange(false);
  }

  async function save() {
    const trimmed = email.trim();
    if (!trimmed) return setError('Email is required.');
    if (!isValidEmail(trimmed)) return setError('Enter a valid email address.');
    setError(null);
    const body: UpdateUserBody = { email: trimmed, display_name: name.trim() };
    if (!isSelf) {
      body.role = role;
      body.is_active = active;
    }
    try {
      await update.mutateAsync({ id: user.id, body });
      toast.show('User updated', { tone: 'success' });
      setTemp(null);
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const errorId = 'edit-user-error';
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => !o && close()}
        title={`Edit ${user.display_name || user.email}`}
        dismissOnBackdrop={!busy}
        isKeyboardDismissDisabled={busy}
        hideClose={busy}
        initialFocus={nameRef}
        footer={
          <>
            <Button variant="neutral" size="md" onPress={close} isDisabled={busy} data-edit-user-cancel>
              Cancel
            </Button>
            <Button variant="primary" size="md" onPress={save} isDisabled={busy} loading={update.isPending} data-edit-user-save>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form
          className={styles.form}
          aria-describedby={error ? errorId : undefined}
          aria-busy={busy || undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <TextField
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            isRequired
            isDisabled={busy}
            mono
            autoComplete="off"
            name="email"
          />
          <TextField ref={nameRef} label="Display name" value={name} onChange={setName} isDisabled={busy} name="display_name" />
          <Select
            label="Role"
            items={[
              { key: 'MEMBER', label: 'Member' },
              { key: 'ADMIN', label: 'Admin' },
            ]}
            value={role}
            onChange={(k) => setRole(k === 'ADMIN' ? 'ADMIN' : 'MEMBER')}
            isDisabled={busy || isSelf}
            name="role"
          />
          <Checkbox isSelected={active} onChange={setActive} isDisabled={busy || isSelf} name="is_active">
            Active
          </Checkbox>
          {isSelf ? (
            <Text variant="sm" tone="muted" data-self-note>
              You are editing your own account: role and active status cannot be changed here.
            </Text>
          ) : null}
          {localAuth && !isSelf ? (
            <section className={styles.resetSection} aria-labelledby="edit-user-password-title" data-password-section>
              <Text variant="md" as="h3" id="edit-user-password-title">
                Password
              </Text>
              {temp ? (
                <div className={styles.temp} data-temp-password>
                  <Text variant="sm" tone="muted" as="label" htmlFor="edit-user-temp-value">
                    One-time password — give it to the user. It is not shown again.
                  </Text>
                  <div className={styles.tempRow}>
                    <input
                      id="edit-user-temp-value"
                      className={styles.tempInput}
                      readOnly
                      value={temp}
                      onFocus={(e) => e.target.select()}
                      data-secret
                    />
                    <CopyButton
                      text={temp}
                      label="Copy temporary password"
                      onCopied={() => toast.show('Temporary password copied', { tone: 'success' })}
                    />
                  </div>
                </div>
              ) : (
                <div className={styles.resetRow}>
                  <Text variant="sm" tone="secondary">
                    Signs them out everywhere and replaces their password with a one-time one.
                  </Text>
                  <Button
                    variant="danger"
                    onPress={() => setConfirmReset(true)}
                    isDisabled={busy}
                    loading={reset.isPending}
                    data-reset-password
                  >
                    {reset.isPending ? 'Resetting…' : 'Reset password'}
                  </Button>
                </div>
              )}
            </section>
          ) : null}
          {error ? (
            <Text variant="sm" tone="danger" role="alert" id={errorId} data-edit-user-error>
              {error}
            </Text>
          ) : null}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset password"
        tone="danger"
        description={[
          `Reset the password for ${user.email}? The current password stops working now. They are signed out of every browser.`,
          'You will get a one-time password to give to the user. They must choose a new password when they sign in.',
        ]}
        confirmLabel="Reset password"
        onConfirm={async () => {
          try {
            const result = await reset.mutateAsync(user.id);
            setTemp(result.temporary_password);
            setError(null);
          } catch (e) {
            setError(errorText(e));
          }
        }}
      />
    </>
  );
}
