/** Right-hand diagnosis detail: header actions, AI vs Human issues, previews, lazy full detail (o), inline edit. */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useCorrection, type CorrectionRow } from '@/api/reviews';
import { runPath } from '@/app/routes';
import { textDirAttrs } from '@/lib/text';
import {
  Button,
  ErrorState,
  JsonTree,
  Kbd,
  Skeleton,
  Tag,
  Text,
  TextBlock,
  ReviewStatusMark,
  Tooltip,
  TaskTag,
  DatasetTag,
  ModelTag,
  UserName,
} from '@/ui';
import { formatDate } from '../datasets/lib/itemValue';
import { IssueEditForm, IssueList } from './IssueList';
import { correctionPriority } from './lib/filters';
import styles from './DetailPane.module.css';

/** C179: Reject and Delete say what they do, because they end in different places. */
export const REJECT_TIP = 'Reject: the issue stays on the run, marked wrong, and leaves the queue.';
export const DELETE_TIP =
  'Delete: the issue leaves the run’s root causes and Reviews. An audit record is kept.';

export interface DetailPaneProps {
  row: CorrectionRow;
  position: { index: number; total: number };
  showProject: boolean;
  expanded: boolean;
  editing: boolean;
  busy: boolean;
  saving: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onSaveEdit: (issues: CorrectionRow['human_root_cause_issues']) => void;
  onCancelEdit: () => void;
}

export { ReviewStatusMark };

/** The diagnosis an edit starts from: the human issues, else the AI's (an AI candidate has no human issues yet). */
export function editSeed(row: CorrectionRow): CorrectionRow['human_root_cause_issues'] {
  const human = row.human_root_cause_issues ?? [];
  return human.length ? human : (row.ai_root_cause_issues ?? []);
}

export function DetailPane(p: DetailPaneProps) {
  const { row } = p;
  const priority = correctionPriority(row);
  const runHref = row.run_id
    ? `${runPath(row.project_slug, row.run_id)}${new URLSearchParams({ ...(row.pass_number != null && !row.pass_deleted_at ? { pass: String(row.pass_number) } : {}), ...(row.item_id ? { item: row.item_id } : {}) }).toString().replace(/^(?=.)/, '?')}`
    : null;
  const pending = row.status === 'pending';
  return (
    <aside className={styles.pane} aria-label={`Diagnosis ${row.id}`} data-detail-pane={row.id}>
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <Text as="h2" variant="lg" mono>
            #{row.id} · {row.item_id}
          </Text>
          <ReviewStatusMark status={row.status} />
          {priority ? (
            <span title={priority.reasons.join(' · ')}>
              <Tag tone={priority.level === 'high' ? 'danger' : 'warning'}>{priority.label}</Tag>
            </span>
          ) : null}
          {row.self_reviewed ? <Tag>Self-approved</Tag> : null}
          <span className={styles.pos}>
            {p.position.index + 1} / {p.position.total}
          </span>
        </div>
        <div className={styles.meta}>
          {typeof row.ai_confidence === 'number' ? (
            <span>AI confidence {Math.round(row.ai_confidence * 100)}%</span>
          ) : null}
          {row.corrected_by ? (
            <span>
              by{' '}
              <UserName
                id={row.corrected_by.id}
                name={row.corrected_by.display_name}
                email={row.corrected_by.email}
              />
            </span>
          ) : null}
          <span>{formatDate(row.created_at)}</span>
        </div>
        <div className={styles.actions}>
          {pending ? (
            <>
              <Button
                variant="accent"
                size="sm"
                onPress={p.onApprove}
                isDisabled={p.busy || Boolean(row.review_block)}
                data-testid="detail-approve"
                aria-keyshortcuts="a"
              >
                Approve{' '}
                <span aria-hidden="true">
                  <Kbd>a</Kbd>
                </span>
              </Button>
              <Tooltip content={REJECT_TIP}>
                <Button
                  variant="danger"
                  size="sm"
                  onPress={p.onReject}
                  isDisabled={p.busy || Boolean(row.review_block)}
                  data-testid="detail-reject"
                  aria-keyshortcuts="r"
                >
                  Reject{' '}
                  <span aria-hidden="true">
                    <Kbd>r</Kbd>
                  </span>
                </Button>
              </Tooltip>
            </>
          ) : (
            <Button
              variant="neutral"
              size="sm"
              onPress={p.onReset}
              isDisabled={p.busy || Boolean(row.review_block)}
              data-testid="detail-reset"
            >
              Reset
            </Button>
          )}
          <Button
            variant="neutral"
            size="sm"
            onPress={p.onEdit}
            isDisabled={p.editing}
            data-testid="detail-edit"
            aria-keyshortcuts="e"
          >
            {/* C054: an edit withdraws the decision; the server asks for the decision right */}
            {pending ? 'Edit' : 'Edit (sends back to review)'}{' '}
            <span aria-hidden="true">
              <Kbd>e</Kbd>
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={p.onToggle}
            aria-expanded={p.expanded}
            data-testid="detail-toggle"
            aria-keyshortcuts="o"
          >
            {p.expanded ? 'Hide details' : 'Details'}{' '}
            <span aria-hidden="true">
              <Kbd>o</Kbd>
            </span>
          </Button>
          <Tooltip content={DELETE_TIP}>
            <Button
              variant="danger"
              size="sm"
              onPress={p.onDelete}
              isDisabled={p.busy}
              data-testid="detail-delete"
            >
              Delete
            </Button>
          </Tooltip>
        </div>
        {row.review_block ? (
          <Text variant="sm" tone="warning" role="status" data-review-block>
            {row.review_block}
          </Text>
        ) : null}
      </header>

      <div className={styles.chips}>
        <Chipline label="Task" value={row.task} node={<TaskTag name={row.task} />} />
        <Chipline label="Metric" value={row.metric_name} />
        {p.showProject ? (
          <Chipline
            label="Project"
            value={row.project_name}
            href={`/projects/${encodeURIComponent(row.project_slug)}/reviews`}
          />
        ) : null}
        <Chipline label="Run" value={row.run_name} href={runHref} />
        {row.pass_number != null ? <Chipline label="Pass" value={String(row.pass_number)} /> : null}
        <Chipline label="Dataset" value={row.dataset} node={<DatasetTag name={row.dataset} />} />
        <Chipline
          label="Model"
          value={row.model}
          node={row.model ? <ModelTag name={row.model} reasoning={!!row.has_reasoning} /> : null}
        />
      </div>

      <div className={styles.columns}>
        <section aria-label="AI root-cause issues">
          <Text variant="sm" tone="muted" weight={650} className={styles.colHead}>
            AI ROOT-CAUSE ISSUES
          </Text>
          <IssueList issues={row.ai_root_cause_issues ?? []} tone="ai" />
        </section>
        <section aria-label="Human root-cause issues">
          <Text variant="sm" tone="muted" weight={650} className={styles.colHead}>
            HUMAN ROOT-CAUSE ISSUES
          </Text>
          {p.editing ? (
            <IssueEditForm
              initial={editSeed(row)}
              single={Boolean(row.issue_id)}
              projectSlug={row.project_slug}
              runHref={runHref}
              saving={p.saving}
              onSave={p.onSaveEdit}
              onCancel={p.onCancelEdit}
            />
          ) : (
            <IssueList issues={row.human_root_cause_issues ?? []} tone="human" />
          )}
        </section>
      </div>

      {!p.expanded ? (
        <div className={styles.previews}>
          <Preview label="Input" text={row.input_preview} />
          <Preview label="Expected" text={row.expected_preview} />
          <Preview label="Output" text={row.output_preview} />
        </div>
      ) : (
        <FullDetail id={row.id} />
      )}

      {row.reviewed_by ? (
        <footer className={styles.reviewed}>
          Reviewed by{' '}
          <UserName
            id={row.reviewed_by.id}
            name={row.reviewed_by.display_name}
            email={row.reviewed_by.email}
          />
          {row.reviewed_at ? ` · ${formatDate(row.reviewed_at)}` : ''}
          {row.review_comment ? ` · “${row.review_comment}”` : ''}
        </footer>
      ) : null}
    </aside>
  );
}

function Chipline({
  label,
  value,
  href,
  node,
}: {
  label: string;
  value: string | null | undefined;
  href?: string | null;
  /** Draws the value with a shared component (TaskTag, DatasetTag, ModelTag: C165). */
  node?: ReactNode;
}) {
  if (!value) return null;
  return (
    <span className={styles.chip}>
      <span className={styles.chipLabel}>{label}</span>
      {node ? (
        node
      ) : href ? (
        <Link to={href} className={styles.chipLink}>
          {value}
        </Link>
      ) : (
        <span className={styles.chipValue}>{value}</span>
      )}
    </span>
  );
}

function Preview({ label, text }: { label: string; text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className={styles.preview}>
      <span className={styles.previewLabel}>{label}</span>
      <p className={styles.previewText} {...textDirAttrs(text)}>
        {text}
      </p>
    </div>
  );
}

function Snapshot({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <section className={styles.snapshot} aria-label={label}>
      <Text variant="sm" tone="muted" weight={650}>
        {label.toUpperCase()}
      </Text>
      {typeof value === 'string' ? (
        <TextBlock text={value} />
      ) : (
        <JsonTree data={value} expandDepth={1} label={label} />
      )}
    </section>
  );
}

function FullDetail({ id }: { id: number }) {
  const q = useCorrection(id);
  if (q.isPending) return <Skeleton kind="lines" rows={4} label="Loading details" />;
  if (q.isError)
    return (
      <ErrorState compact error={q.error} title="Couldn’t load details" onRetry={() => void q.refetch()} />
    );
  const d = q.data;
  const scores = Object.entries(d.scores_snapshot ?? {});
  return (
    <div className={styles.full} data-full-detail>
      <Snapshot label="Input" value={d.input_snapshot} />
      <Snapshot label="Expected" value={d.expected_snapshot} />
      <Snapshot label="Output" value={d.output_snapshot} />
      {scores.length ? (
        <section aria-label="Metric scores" className={styles.scores}>
          <Text variant="sm" tone="muted" weight={650}>
            METRIC SCORES
          </Text>
          <div className={styles.scoreRow}>
            {scores.map(([k, v]) => (
              <Tag key={k} kind="data">
                {k}:{' '}
                {typeof v === 'number' ? v.toFixed(2) : typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </Tag>
            ))}
          </div>
        </section>
      ) : null}
      {d.history?.length ? (
        <section aria-label="Revision history">
          <Text variant="sm" tone="muted" weight={650}>
            REVISION HISTORY
          </Text>
          <ol className={styles.history}>
            {d.history.map((h) => (
              <li key={h.revision_id}>
                <span className={styles.histWhen}>{formatDate(h.created_at)}</span>
                <span>
                  Revision {h.revision_number} by{' '}
                  {h.actor_user ? (
                    <UserName
                      id={h.actor_user.id}
                      name={h.actor_user.display_name}
                      email={h.actor_user.email}
                    />
                  ) : (
                    h.actor_source
                  )}
                </span>
                {h.review ? <ReviewStatusMark status={h.review.status} /> : null}
                {h.review?.review_comment ? <span>“{h.review.review_comment}”</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {d.item_metadata && Object.keys(d.item_metadata).length ? (
        <Snapshot label="Item metadata" value={d.item_metadata} />
      ) : null}
    </div>
  );
}
