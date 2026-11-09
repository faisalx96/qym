/**
 * The Credentials row and its notices (spec-b B4-28 to B4-38). States only: no prefix, id or secret
 * ever reaches the browser. Visible to every project member.
 */
import type { ReactNode } from 'react';
import { isTerminalJob, type CredentialState, type ExperimentDetail } from '@/api/experiments';
import { formatHeaderDate, toDate } from '@/lib/dates';
import { Eyebrow, Text, StatusMark } from '@/ui';
import { Callout } from '../launch/components/Callout';
import {
  CREDENTIALS_TITLE,
  CRED_API_KEY,
  CRED_DATASET_TOKEN,
  TOKEN_ENV_KEY,
  TOKEN_UNAVAILABLE_REASON,
  notSentLead,
  notSentTail,
  revokedWarning,
} from './copy';
import styles from './detail.module.css';

/** 'Nov 5, 2026, 23:37' (lib/dates header form). */
export function revokedLabel(iso: string): string {
  return toDate(iso) ? formatHeaderDate(iso) : '';
}

export interface TokenFacts {
  /** Environments (table order) with a job whose schema does not declare the token. */
  notDeclared: string[];
  /** Every job is `not_declared`: the token exists but no environment takes it. */
  neverSent: boolean;
  /** The token was revoked while a job still waits for it (blocked until retried). */
  revokedStillNeeded: boolean;
}

export function tokenFacts(detail: ExperimentDetail): TokenFacts {
  const token = detail.credentials.dataset_read_token;
  const flagged = detail.jobs.filter((j) => j.dataset_token != null);
  const names: string[] = [];
  for (const job of flagged)
    if (job.dataset_token === 'not_declared') {
      const name = job.environment_name || job.environment_id;
      if (!names.includes(name)) names.push(name);
    }
  const blocked = detail.jobs.some(
    (j) => j.status === 'BLOCKED' && !j.superseded && j.error === TOKEN_UNAVAILABLE_REASON,
  );
  return {
    notDeclared: names,
    neverSent:
      token.state === 'active' &&
      flagged.length > 0 &&
      flagged.every((j) => j.dataset_token === 'not_declared'),
    revokedStillNeeded: token.state === 'revoked' && blocked,
  };
}

function CredBadge({
  state,
  label,
  sent = true,
}: {
  state: CredentialState;
  label?: string;
  sent?: boolean;
}) {
  if (state.state === 'none') return <StatusMark tone="neutral" shape="ring" label="not issued" />;
  if (state.state === 'revoked')
    return (
      <>
        <StatusMark tone="warning" shape="pause" label="revoked" title={state.revoked_at ?? undefined} />
        {label ? <Text as="span" variant="sm" tone="muted">{` ${label}`}</Text> : null}
      </>
    );
  return sent ? (
    <StatusMark tone="success" shape="full" label="active" />
  ) : (
    <StatusMark tone="warning" shape="hourglass" label="not sent" />
  );
}

/**
 * The row shows only when a credential needs attention (C137): the token is not sent, or a credential is revoked
 * while a job still waits (not terminal, or BLOCKED). The platform revokes both when the experiment settles, so a
 * revoked key on a settled experiment is normal and shows nothing.
 */
export function credentialsNeedAttention(detail: ExperimentDetail): boolean {
  const { api_key: apiKey, dataset_read_token: token } = detail.credentials;
  const facts = tokenFacts(detail);
  if (facts.neverSent || facts.notDeclared.length) return true;
  const waiting = detail.jobs.some(
    (j) => !j.superseded && (!isTerminalJob(j.status) || j.status === 'BLOCKED'),
  );
  return waiting && (apiKey.state === 'revoked' || token.state === 'revoked');
}

export function Credentials({ detail }: { detail: ExperimentDetail }) {
  const { api_key: apiKey, dataset_read_token: token } = detail.credentials;
  const facts = tokenFacts(detail);
  if (!credentialsNeedAttention(detail)) return null;
  const at = (c: CredentialState) => (c.revoked_at ? revokedLabel(c.revoked_at) : '');
  let notice: ReactNode = null;
  if (facts.revokedStillNeeded) {
    notice = (
      <Callout tone="warning">
        <span data-testid="token-notice">{revokedWarning(at(token))}</span>
      </Callout>
    );
  } else if (facts.notDeclared.length) {
    notice = (
      <Callout tone="info">
        <span data-testid="token-notice">
          {notSentLead(facts.notDeclared)}{' '}
          <Text variant="base" as="span" mono>
            {TOKEN_ENV_KEY}
          </Text>
          {notSentTail(facts.notDeclared)}
        </span>
      </Callout>
    );
  }
  return (
    <>
      <section className={styles.creds} aria-label={CREDENTIALS_TITLE} data-testid="exp-credentials">
        <Eyebrow>{CREDENTIALS_TITLE}</Eyebrow>
        <dl className={styles.credList}>
          <div className={styles.credItem}>
            <dt className={styles.credName}>{CRED_API_KEY}</dt>
            <dd className={styles.credValue} data-testid="cred-api-key">
              <CredBadge state={apiKey} label={at(apiKey)} />
            </dd>
          </div>
          <div className={styles.credItem}>
            <dt className={styles.credName}>{CRED_DATASET_TOKEN}</dt>
            <dd className={styles.credValue} data-testid="cred-dataset-token">
              <CredBadge state={token} label={at(token)} sent={!facts.neverSent} />
            </dd>
          </div>
        </dl>
      </section>
      {notice}
    </>
  );
}
