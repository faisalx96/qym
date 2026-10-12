import { classifyError, loginUrl } from '@/lib/http';
import { Button } from '../Button';
import { LinkButton } from '../LinkButton';
import { Text } from '../Text';
import styles from './ErrorState.module.css';

export interface ErrorStateProps {
  error: unknown;
  title?: string;
  message?: string;
  notFoundMessage?: string;
  onRetry?: () => void;
  compact?: boolean;
}

/** A failed load is never an empty state (DESIGN_LANGUAGE §3 "Failed requests"). */
export function ErrorState({
  error,
  title = 'Couldn’t load this',
  message,
  notFoundMessage,
  onRetry,
  compact,
}: ErrorStateProps) {
  const info = classifyError(error);
  const body = message ?? (info.kind === 'not_found' && notFoundMessage) ?? info.message;
  const meta: string[] = [];
  if (info.status) meta.push(`HTTP ${info.status}`);
  if (
    info.detail &&
    info.detail !== `HTTP ${info.status}` &&
    info.kind !== 'network' &&
    info.detail.toLowerCase() !== title.toLowerCase()
  ) {
    meta.push(info.detail);
  }
  const retryable = ['server', 'network', 'unknown', 'client'].includes(info.kind);
  return (
    <div
      className={styles.error}
      role="alert"
      data-error-kind={info.kind}
      data-compact={compact ? '' : undefined}
    >
      <Text variant={compact ? 'md' : 'xl'} as="h2" className={styles.title}>
        {title}
      </Text>
      <Text variant="md" tone="muted" weight={400} as="p" className={styles.body}>
        {body}
      </Text>
      {meta.length ? (
        <Text variant="sm" as="p" className={styles.detail}>
          {meta.join(' · ')}
        </Text>
      ) : null}
      <div className={styles.actions}>
        {info.kind === 'auth' ? (
          <LinkButton href={loginUrl()} variant="accent">
            Sign in
          </LinkButton>
        ) : retryable && onRetry ? (
          <Button variant="accent" onPress={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}
