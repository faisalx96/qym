import { Button } from '../Button';
import { Icon } from '../Icon';
import styles from './StaleBanner.module.css';

export interface StaleBannerProps {
  since: Date;
  filtersApplied: boolean;
  onRetry?: () => void;
  now?: Date;
}

export function relativeAge(since: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
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
        <Button variant="ghost" onPress={onRetry} icon={<Icon name="retry" size={12} />}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
