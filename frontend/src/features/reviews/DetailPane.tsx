/** Right-hand correction detail: header actions, AI vs Human issues, previews, lazy full detail (o), inline edit. */
import { Link } from 'react-router-dom';
import { useCorrection, type CorrectionRow } from '@/api/reviews';
import { runPath } from '@/app/routes';
import { textDirAttrs } from '@/lib/text';
import { Badge, Button, ErrorState, JsonTree, Kbd, Skeleton, Tag, Text, TextBlock } from '@/ui';
import { formatDate } from '../datasets/lib/itemValue';
import { IssueEditForm, IssueList } from './IssueList';
import { correctionPriority } from './lib/filters';
import styles from './DetailPane.module.css';

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

export const STATUS_TONE = { pending: 'neutral', approved: 'success', rejected: 'danger' } as const;

export function DetailPane(p: DetailPaneProps) {
  const { row } = p;
  const priority = correctionPriority(row);
  const runHref = row.run_id
    ? `${runPath(row.project_slug, row.run_id)}${new URLSearchParams({ ...(row.pass_number != null && !row.pass_deleted_at ? { pass: String(row.pass_number) } : {}), ...(row.item_id ? { item: row.item_id } : {}) }).toString().replace(/^(?=.)/, '?')}`
    : null;
  const pending = row.status === 'pending';
  return (
    <aside className={styles.pane} aria-label={`Correction ${row.id}`} data-detail-pane={row.id}>
      <header className={styles.head}>
        <div className={styles.titleRow}>
          <Text as="h2" variant="lg" mono>
            #{row.id} · {row.item_id}
          </Text>
          <Badge tone={STATUS_TONE[row.status]} glyph={row.status === 'APPROVED' ? '✓' : undefined}>
            {row.status}
          </Badge>
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
            <span>by {row.corrected_by.display_name || row.corrected_by.email}</span>
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
              >
                Approve <Kbd>a</Kbd>
              </Button>
              <Button
                variant="danger"
                size="sm"
                onPress={p.onReject}
                isDisabled={p.busy || Boolean(row.review_block)}
                data-testid="detail-reject"
              >
                Reject <Kbd>r</Kbd>
              </Button>
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
          >
            Edit <Kbd>e</Kbd>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={p.onToggle}
            aria-expanded={p.expanded}
            data-testid="detail-toggle"
          >
            {p.expanded ? 'Hide details' : 'Details'} <Kbd>o</Kbd>
          </Button>
          <Button variant="ghost" size="sm" onPress={p.onDelete} isDisabled={p.busy}>
            Delete
          </Button>
        </div>
        {row.review_block ? (
          <Text variant="sm" tone="warning" role="status" data-review-block>
            {row.review_block}
          </Text>
        ) : null}
      </header>

      <div className={styles.chips}>
        <Chipline label="Task" value={row.task} />
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
        <Chipline label="Dataset" value={row.dataset} />
        <Chipline
          label="Model"
          value={row.has_reasoning && row.model ? `${row.model} (reasoning)` : row.model}
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
              initial={row.human_root_cause_issues ?? []}
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
          Reviewed by {row.reviewed_by.display_name || row.reviewed_by.email}
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
}: {
  label: string;
  value: string | null | undefined;
  href?: string | null;
}) {
  if (!value) return null;
  return (
    <span className={styles.chip}>
      <span className={styles.chipLabel}>{label}</span>
      {href ? (
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
                <span>#{h.revision_number}</span>
                <span>{h.actor_user?.display_name || h.actor_user?.email || h.actor_source}</span>
                {h.review ? <Badge tone={STATUS_TONE[h.review.status]}>{h.review.status}</Badge> : null}
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
