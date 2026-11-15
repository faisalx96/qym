/** Creator / Published by pill: initials avatar + display name (shell owner-pill). */
import type { DsUser } from '@/api/datasets';
import { UserName } from '@/ui';
import styles from './UserPill.module.css';

export function initials(user: DsUser | null | undefined): string {
  const name = user?.display_name || user?.email || '';
  const parts = name
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

/** A person in the datasets area: the shared UserName (C144), after an optional label such as "Drafted by". */
export function UserPill({ user, label }: { user: DsUser | null | undefined; label?: string }) {
  if (!user) return null;
  return (
    <span className={styles.person}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <UserName id={user.id} name={user.display_name} email={user.email} />
    </span>
  );
}
