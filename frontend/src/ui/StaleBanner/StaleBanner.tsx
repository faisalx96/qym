import { formatAgo } from '@/lib/dates';
import { Button } from '../Button';
import { Icon } from '../Icon';
import styles from './StaleBanner.module.css';

export interface StaleBannerProps {
  since: Date;
  filtersApplied: boolean;
  onRetry?: () => void;
  now?: Date;
}

/** 'just now', '2m ago', '3h ago' (lib/dates formatAgo, C-09). */
export function relativeAge(since: Date, now = new Date()): string {
  return formatAgo(since, now);
}

/** Shown above dimmed rows when a refresh failed (role=status). */
export function StaleBanner({ since, filtersApplied, onRetry, now }: StaleBannerProps) {
  return (
    <div className={styles.banner} role="status">
      <Icon name="warning" size={14} />
      <span>
        Showing data from {relativeAge(since, now)}.{' '}
        {filtersApplied ? '' : 'Your latest filter change is not applied yet.'}
      </span>
      {onRetry ? (
        <Button variant="neutral" onPress={onRetry} icon={<Icon name="retry" size={12} />}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
