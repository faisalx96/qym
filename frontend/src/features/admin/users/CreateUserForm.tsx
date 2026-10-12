import { useState } from 'react';
import { useCreateUser } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { useSubmitLock } from '@/lib/pending';
import { Button, Select, TextField, useToast } from '@/ui';
import { isValidEmail } from '../format';
import styles from './users.module.css';

export interface CreateUserFormProps {
  /** Called with the created/existing user id so the table can highlight it. */
  onCreated?: (id: string, existing: boolean) => void;
}

/** Inline add-bar: email (validated), display name, role; Enter submits. */
export function CreateUserForm({ onCreated }: CreateUserFormProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const create = useCreateUser();
  const lock = useSubmitLock();
  const toast = useToast();

  async function submit() {
    const trimmed = email.trim();
    if (!trimmed) return setError('Email is required.');
    if (!isValidEmail(trimmed)) return setError('Enter a valid email address.');
    setError(null);
    try {
      const result = await create.mutateAsync({
        email: trimmed,
        display_name: name.trim() || undefined,
        role,
      });
      if (result.existing) {
        toast.show(`${result.email} already exists`, { tone: 'info' });
      } else {
        toast.show(`User ${result.email} created`, { tone: 'success' });
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
    <form
      className={styles.addBar}
      aria-label="Create user"
      data-create-user
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
        type="email"
        placeholder="user@example.com"
        isRequired
        mono
        width={240}
        errorMessage={error ?? undefined}
        isDisabled={create.isPending}
        name="email"
      />
      <TextField
        label="Display name"
        value={name}
        onChange={setName}
        placeholder="Optional"
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
      >
        Create user
      </Button>
    </form>
  );
}
