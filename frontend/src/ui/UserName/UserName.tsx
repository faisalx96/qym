import styles from './UserName.module.css';

/** Series hue 1..8 from a user id: the same person is the same colour everywhere. */
export function userSeries(id: string | null | undefined): number | undefined {
  if (!id) return undefined;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 8) + 1;
}

/** Up to two initials from a display name (or an email when there is no name). */
export function userInitials(label: string): string {
  return label
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export interface UserNameProps {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  /** Shows the email after the name, muted (lists where the email tells two people apart). */
  showEmail?: boolean;
  className?: string;
}

/**
 * A person: an initials disc in the person's series colour, then the name (round 11: the runs table Owner cell, now
 * the one way to show a user, in admin users, project members and the add-member search).
 */
export function UserName({ id, name, email, showEmail, className }: UserNameProps) {
  const label = name || email || '—';
  return (
    <span className={[styles.user, className].filter(Boolean).join(' ')} title={email ?? undefined}>
      <span className={styles.avatar} data-series={userSeries(id)} aria-hidden="true">
        {userInitials(label)}
      </span>
      <span className={styles.name} dir="auto">
        {label}
      </span>
      {showEmail && email && email !== label ? <span className={styles.email}>{email}</span> : null}
    </span>
  );
}
