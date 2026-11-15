import type { ReactNode } from 'react';
import { errorIdentifiers, errorReport } from '@/lib/error-report';
import { CopyButton } from '../CopyButton';
import { classifyError, loginUrl } from '@/lib/http';
import { Button } from '../Button';
import { Icon } from '../Icon';
import { LinkButton } from '../LinkButton';
import { Text } from '../Text';
import styles from './ErrorState.module.css';

export interface ErrorStateProps {
  error: unknown;
  title?: string;
  message?: string;
  notFoundMessage?: string;
  /** C156: the title when the thing is missing: '<Thing> not found' (the default title names a load failure). */
  notFoundTitle?: string;
  onRetry?: () => void;
  compact?: boolean;
  /** Extra action beside Retry / Sign in. */
  action?: ReactNode;
  /** C156: a not-found links to its parent list ('Runs', 'Datasets'); no HTTP line, no Retry. */
  parent?: { to: string; label: string };
}

/** A failed load is never an empty state (DESIGN_LANGUAGE §3 "Failed requests"). */
export function ErrorState({
  error,
  title = 'Couldn’t load this',
  message,
  notFoundMessage,
  notFoundTitle,
  onRetry,
  compact,
  action,
  parent,
}: ErrorStateProps) {
  const info = classifyError(error);
  const notFound = info.kind === 'not_found';
  const heading = notFound && notFoundTitle ? notFoundTitle : title;
  // C018: `false && x` is not nullish, so the old `a ?? (cond && b) ?? c` hid every cause but a not-found one.
  const body = message ?? (notFound ? notFoundMessage : undefined) ?? info.message;
  const meta: string[] = [];
  if (info.status && !notFound) meta.push(`HTTP ${info.status}`);
  if (
    !notFound &&
    info.detail &&
    info.detail !== `HTTP ${info.status}` &&
    info.kind !== 'network' &&
    info.detail.toLowerCase() !== heading.toLowerCase()
  ) {
    meta.push(info.detail);
  }
  const identifiers = errorIdentifiers(error);
  // C-38: a not-found shows no error code and no request line.
  if (!notFound) {
    if (identifiers.code) meta.push(identifiers.code);
    if (identifiers.request_id) meta.push(`request ${identifiers.request_id}`);
  }
  const retryable = ['server', 'network', 'unknown', 'client'].includes(info.kind);
  return (
    <div
      className={styles.error}
      role="alert"
      data-error-kind={info.kind}
      data-compact={compact ? '' : undefined}
    >
      {notFound && !compact ? (
        <div className={styles.icon} aria-hidden="true">
          <Icon name="warning" />
        </div>
      ) : null}
      <Text variant={compact ? 'md' : 'xl'} as="h2" className={styles.title}>
        {heading}
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
        {notFound && parent ? (
          <LinkButton to={parent.to} variant="neutral" icon={<Icon name="prev" size={12} />}>
            {parent.label}
          </LinkButton>
        ) : null}
        {action}
        {!notFound && (identifiers.code || identifiers.request_id) ? (
          <CopyButton label="Copy report" text={() => errorReport(error, { title: heading })} />
        ) : null}
      </div>
    </div>
  );
}
