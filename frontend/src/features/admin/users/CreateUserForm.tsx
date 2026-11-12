import { useState } from 'react';
import { useCreateUser } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { useSubmitLock } from '@/lib/pending';
import { Button, CopyButton, Select, Text, TextField, useToast } from '@/ui';
import { isValidEmail } from '../format';
import styles from './users.module.css';

export interface CreateUserFormProps {
  /** Called with the created/existing user id so the table can highlight it. */
  onCreated?: (id: string, existing: boolean) => void;
  /** Email/password sign-in is on: a new user gets a one-time password (C131). */
  localAuth?: boolean;
  /** The sign-in providers a new user uses when password sign-in is off (C131). */
  providers?: string[];
}

/** 'Google', 'Google or GitLab', 'Google, GitHub or GitLab'. */
function either(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

/**
 * Inline add-bar: email, display name, role; Enter submits. The app checks the email (not the browser) and draws its
 * error on a reserved line under the whole bar, so the fields never move (C243). With password sign-in on, the new
 * user's one-time password shows once under the bar, with Copy (C131).
 */
export function CreateUserForm({ onCreated, localAuth = false, providers = [] }: CreateUserFormProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const create = useCreateUser();
  const lock = useSubmitLock();
  const toast = useToast();

  async function submit() {
    const trimmed = email.trim();
    if (!trimmed) return setError('Email is required.');
    if (!isValidEmail(trimmed)) return setError('Enter a valid email address.');
    setError(null);
    setSecret(null);
    try {
      const result = await create.mutateAsync({
        email: trimmed,
        display_name: name.trim() || undefined,
        role,
      });
      if (result.existing) {
        toast.show(`${result.email} already exists`, { tone: 'info' });
      } else {
        if (result.temporary_password) {
          setSecret({ email: result.email, password: result.temporary_password });
        } else {
          const via = !localAuth && providers.length ? ` They sign in with ${either(providers)}.` : '';
          toast.show(`User ${result.email} created.${via}`, { tone: 'success' });
        }
        setEmail('');
        setName('');
        setRole('MEMBER');
      }
      onCreated?.(result.id, Boolean(result.existing));
    } catch (e) {
      setError(
        e instanceof ApiError ? e.detail || `HTTP ${e.status}` : e instanceof Error ? e.message : String(e),
      );
    }
  }

  return (
    <div className={styles.createBlock}>
      <form
        className={styles.addBar}
        aria-label="Create user"
        aria-describedby="create-user-error"
        data-create-user
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void lock(submit);
        }}
      >
        <TextField
          label="Email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            if (error) setError(null);
          }}
          type="text"
          inputMode="email"
          autoComplete="off"
          validationBehavior="aria"
          placeholder="user@example.com"
          isRequired
          isInvalid={Boolean(error)}
          mono
          width={240}
          isDisabled={create.isPending}
          name="email"
        />
        <TextField
          label="Display name"
          value={name}
          onChange={setName}
          width={180}
          isDisabled={create.isPending}
          name="display_name"
        />
        <Select
          label="Role"
          items={[
            { key: 'MEMBER', label: 'Member' },
            { key: 'ADMIN', label: 'Admin' },
          ]}
          value={role}
          onChange={(k) => setRole(k === 'ADMIN' ? 'ADMIN' : 'MEMBER')}
          width={120}
          isDisabled={create.isPending}
          name="role"
        />
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          isDisabled={!email.trim() || create.isPending}
          disabledReason="Enter an email address first"
        >
          Create user
        </Button>
      </form>
      <p className={styles.barError} id="create-user-error" role="alert" data-create-user-error>
        {error}
      </p>
      {secret ? (
        <div className={styles.created} data-created-user>
          <Text variant="md" as="label" htmlFor="created-user-password">
            User {secret.email} created. One-time password:
          </Text>
          <div className={styles.tempRow}>
            <input
              id="created-user-password"
              className={styles.tempInput}
              readOnly
              value={secret.password}
              onFocus={(e) => e.target.select()}
              data-secret
            />
            <CopyButton text={secret.password} label="Copy one-time password" />
          </div>
          <Text variant="sm" tone="muted">
            They set a new password at first sign-in. It is not shown again.
          </Text>
        </div>
      ) : null}
    </div>
  );
}
