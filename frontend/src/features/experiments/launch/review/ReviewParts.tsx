import { Fragment, type ReactNode } from 'react';
import { Badge, Button, Card, Text } from '@/ui';
import { plural } from '../../lib/format';
import { Callout } from '../components/Callout';
import { ProblemList } from '../components/ProblemList';
import {
  CEILING_POINTER,
  CEILING_WARNING_ACTION,
  CEILING_WARNING_TITLE,
  TOKEN_WARNING_TITLE,
} from '../copy';
import { useLaunch } from '../LaunchContext';
import { validationItem, type LaunchWarning } from '../model';
import styles from './reviewStep.module.css';

/** One framed review card: a title (or a custom head) over its body. */
export function ReviewCard({
  title,
  head,
  part,
  label,
  children,
}: {
  title?: ReactNode;
  head?: ReactNode;
  part?: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div data-part={part}>
      <Card as="section" aria-label={label}>
        <div className={styles.stack}>
          {head ?? (
            <Text variant="lg" weight={650} as="h3" className={styles.cardTitle}>
              {title}
            </Text>
          )}
          {children}
        </div>
      </Card>
    </div>
  );
}

export interface KvRow {
  key: string;
  label: string;
  value: ReactNode;
  mono?: boolean;
}

/** Summary rows: a 160 px label column and a value column no wider than the reading measure. */
export function ReviewKv({ rows, label = 'Details' }: { rows: readonly KvRow[]; label?: string }) {
  return (
    <dl className={styles.kv} aria-label={label} data-part="review-kv">
      {rows.map((row) => (
        <div key={row.key} className={styles.kvRow} data-row={row.key}>
          <dt>{row.label}</dt>
          <dd data-mono={row.mono ? '' : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const TOKEN_KEY = 'QYM_DATASET_READ_TOKEN';

/** The warning text with the variable name in mono. */
function withMono(message: string): ReactNode {
  return message.split(TOKEN_KEY).map((part, i, all) => (
    <Fragment key={i}>
      {part}
      {i < all.length - 1 ? (
        <Text variant="base" as="span" mono>
          {TOKEN_KEY}
        </Text>
      ) : null}
    </Fragment>
  ));
}

/** Launch-level dry-run warnings: never change the badge and never disable Launch (B5-41). */
export function LaunchWarnings({ warnings }: { warnings: readonly LaunchWarning[] }) {
  const { ctx, focusIssue } = useLaunch();
  return (
    <>
      {warnings.map((w, i) =>
        w.code === 'vllm_ceiling_unset' ? (
          <Callout key={`${w.code}-${i}`} tone="warning" title={CEILING_WARNING_TITLE}>
            <span>{w.message}</span>
            <div>
              <Button
                size="sm"
                variant="neutral"
                onPress={() =>
                  // Opens the step, the section and the collapsed group that holds the setting.
                  focusIssue(validationItem(CEILING_POINTER, w.message, ctx, { source: 'local' }))
                }
              >
                {CEILING_WARNING_ACTION}
              </Button>
            </div>
          </Callout>
        ) : w.code === 'task_unverified' ? (
          <Callout key={`${w.code}-${i}`} tone="warning">
            <span>{w.message}</span>
          </Callout>
        ) : w.code === 'dataset_token_not_declared' ? (
          <Callout key={`${w.code}-${i}`} tone="warning" title={TOKEN_WARNING_TITLE}>
            <span>{withMono(w.message)}</span>
          </Callout>
        ) : null,
      )}
    </>
  );
}

export interface ChangeRow {
  key: string;
  label: string;
  onEdit: () => void;
}

/** "Changes from the starting point": 32 px rows with an Edit button. */
export function ChangesCard({ rows, base }: { rows: readonly ChangeRow[]; base?: string }) {
  void base;
  return (
    <ReviewCard title="Changes from the starting point" part="review-changes" label="Changes">
      {rows.length ? (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.key} className={styles.row}>
              <span>{r.label}</span>
              <Button size="sm" variant="ghost" onPress={r.onEdit} aria-label={`Edit: ${r.label}`}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="base" tone="muted">
          Nothing changed on top of the starting point.
        </Text>
      )}
    </ReviewCard>
  );
}

/** "Checks": Ready or the problem list, with the dry run's warnings above it. */
export function ChecksCard({
  warnings,
  lead,
  statusTestId,
  status,
  ready: readyOverride,
  children,
}: {
  warnings?: readonly LaunchWarning[];
  /** Lines under the badge (what was checked). */
  lead?: ReactNode;
  statusTestId?: string;
  /** The line shown when there is no problem (default: the review's status). */
  status?: string;
  /** Overrides the Ready badge (the editor is not ready while a publish blocker stands). */
  ready?: boolean;
  children?: ReactNode;
}) {
  const { review, preview, mode } = useLaunch();
  const ready =
    review.items.length === 0 &&
    (readyOverride ?? (mode === 'editor' || (!preview.loading && !preview.error && preview.data != null)));
  return (
    <ReviewCard
      part="review-checks"
      label="Checks"
      head={
        <div className={styles.head}>
          <Text variant="lg" weight={650} as="h3" className={styles.cardTitle}>
            Checks
          </Text>
          {review.items.length ? (
            <Badge tone="danger">{plural(review.items.length, 'problem')}</Badge>
          ) : ready ? (
            <Badge tone="success">Ready</Badge>
          ) : (
            <Badge tone="neutral">{preview.loading ? 'Checking' : 'Review'}</Badge>
          )}
        </div>
      }
    >
      <div className={styles.checks}>
        {warnings ? <LaunchWarnings warnings={warnings} /> : null}
        {review.items.length ? (
          <ProblemList items={review.items} label="Problems to fix" />
        ) : (
          <Text variant="base" className={styles.ok} role="status" data-testid={statusTestId}>
            {status ?? (review.status || 'Nothing to check yet')}
          </Text>
        )}
        {lead}
        {children}
      </div>
    </ReviewCard>
  );
}
