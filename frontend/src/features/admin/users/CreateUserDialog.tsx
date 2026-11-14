import { useCreateUser } from '@/api/admin';
import { ApiError } from '@/lib/http';
import { FormDialog, useToast } from '@/ui';
import { isValidEmail } from '../format';

export interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the created/existing user id so the table can highlight it. */
  onCreated?: (id: string, existing: boolean) => void;
  /** Email/password sign-in is on: the new user gets a one-time password (C131). */
  onSecret?: (secret: { email: string; password: string }) => void;
  /** Email/password sign-in is on (C131). */
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
 * Create user (cv4 A2): the "Create user" button of the Users section opens this dialog, so the page shows one
 * clear action instead of a bar that reads like a search. Email (required, checked by the app, not the browser,
 * C243), display name and role. The dialog closes on success. A one-time password (password sign-in on) goes to
 * `onSecret`, so the page can show it once with Copy (C131).
 */
export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
  onSecret,
  localAuth = false,
  providers = [],
}: CreateUserDialogProps) {
  const create = useCreateUser();
  const toast = useToast();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create user"
      confirmLabel="Create user"
      submittingLabel="Creating…"
      fields={[
        {
          name: 'email',
          label: 'Email',
          required: true,
          autoFocus: true,
          mono: true,
          placeholder: 'user@example.com',
          validate: (v) => {
            const s = String(v).trim();
            return s && !isValidEmail(s) ? 'Enter a valid email address.' : null;
          },
        },
        { name: 'display_name', label: 'Display name' },
        {
          name: 'role',
          label: 'Role',
          type: 'select',
          value: 'MEMBER',
          options: [
            { value: 'MEMBER', label: 'Member' },
            { value: 'ADMIN', label: 'Admin' },
          ],
        },
      ]}
      onSubmit={async (values) => {
        try {
          const result = await create.mutateAsync({
            email: String(values.email).trim(),
            display_name: String(values.display_name).trim() || undefined,
            role: values.role === 'ADMIN' ? 'ADMIN' : 'MEMBER',
          });
          if (result.existing) {
            toast.show(`${result.email} already exists`, { tone: 'info' });
          } else if (result.temporary_password) {
            onSecret?.({ email: result.email, password: result.temporary_password });
          } else {
            const via = !localAuth && providers.length ? ` They sign in with ${either(providers)}.` : '';
            toast.show(`User ${result.email} created.${via}`, { tone: 'success' });
          }
          onCreated?.(result.id, Boolean(result.existing));
        } catch (e) {
          if (e instanceof ApiError) return e.detail || `HTTP ${e.status}`;
          throw e;
        }
      }}
    />
  );
}
