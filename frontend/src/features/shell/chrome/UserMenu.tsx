import { useNavigate } from 'react-router-dom';
import { Button as AriaButton } from 'react-aria-components';
import { useLogout } from '@/api/me';
import { bootstrap } from '@/lib/runtime';
import { ActionTile, DropdownMenu, Tag, Text, userInitials, userSeries } from '@/ui';
import { useAuth } from '../AuthContext';
import styles from './UserMenu.module.css';

export interface UserMenuProps {
  /** Avatar only (collapsed sidebar / compact topbar). */
  compact?: boolean;
  placement?: 'top start' | 'bottom end';
  className?: string;
}

/** Avatar + name; menu with role, Profile and Sign out. */
export function UserMenu({ compact, placement = 'bottom end', className }: UserMenuProps) {
  const { me } = useAuth();
  const navigate = useNavigate();
  const logout = useLogout();
  const { sessionAuth } = bootstrap();
  return (
    <DropdownMenu
      label="Account"
      placement={placement}
      header={
        <div className={styles.header}>
          <Text variant="sm" tone="primary" weight={600} as="div" truncate>
            {me.display_name || me.email}
          </Text>
          <Text variant="sm" as="div" mono truncate>
            {me.email}
          </Text>
          <Tag kind="role">{me.role}</Tag>
        </div>
      }
      items={[
        { id: 'profile', label: 'Profile', icon: <ActionTile icon="user" /> },
        ...(sessionAuth
          ? [
              {
                id: 'logout',
                label: 'Sign out',
                icon: <ActionTile icon="logout" />,
                separatorBefore: true,
              },
            ]
          : []),
      ]}
      onAction={(id) => {
        if (id === 'profile') navigate('/profile');
        if (id === 'logout') logout.mutate();
      }}
      trigger={
        <AriaButton
          className={[styles.trigger, className].filter(Boolean).join(' ')}
          data-user-menu
          data-compact={compact ? '' : undefined}
        >
          <span className={styles.avatar} data-series={userSeries(me.id)} aria-hidden="true">
            {userInitials(me.display_name || me.email)}
          </span>
          {!compact ? (
            <span className={styles.text}>
              <span className={styles.name}>{me.display_name || me.email}</span>
              <span className={styles.email}>{me.email}</span>
            </span>
          ) : (
            // Name from content (not aria-label): the visible initials must be part of the name (WCAG 2.5.3).
            <span className={styles.srOnly}>{`${me.display_name || me.email} — account menu`}</span>
          )}
        </AriaButton>
      }
    />
  );
}
