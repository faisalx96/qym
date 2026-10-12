/** Creator / Published By pill: initials avatar + display name (shell owner-pill). */
import type { DsUser } from '@/api/datasets';
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

export function UserPill({ user, label }: { user: DsUser | null | undefined; label?: string }) {
  if (!user) return null;
  const name = user.display_name || user.email;
  return (
    <span className={styles.pill} title={user.email}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <span className={styles.avatar} aria-hidden="true">
        {initials(user)}
      </span>
      <span className={styles.name}>{name}</span>
    </span>
  );
}
