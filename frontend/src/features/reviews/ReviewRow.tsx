/** One 56px queue row. Checkbox, select button and decision actions are siblings (no nested interactive). */
import { useModelIndex } from '@/api/dashboard';
import type { CorrectionRow } from '@/api/reviews';
import { Checkbox, DatasetTag, IconButton, ModelTag, Tag, TaskTag, Tooltip } from '@/ui';
import { modelSeriesOf } from '@/features/runs-list/model';
import { textDirAttrs } from '@/lib/text';
import { correctionPriority } from './lib/filters';
import { ReviewStatusMark } from './DetailPane';
import { REJECT_TIP } from './DetailPane';
import styles from './ReviewRow.module.css';

export interface ReviewRowProps {
  row: CorrectionRow;
  current: boolean;
  selected: boolean;
  linked: boolean;
  busy: boolean;
  showProject: boolean;
  onSelectRow: () => void;
  onToggleSelected: (v: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
}

export function ReviewRow({
  row,
  current,
  selected,
  linked,
  busy,
  showProject,
  onSelectRow,
  onToggleSelected,
  onApprove,
  onReject,
  onReset,
}: ReviewRowProps) {
  const modelIndex = useModelIndex(row.project_slug);
  const priority = correctionPriority(row);
  const issue = row.human_root_cause_issues?.[0] ?? row.ai_root_cause_issues?.[0];
  const summary = issue
    ? [issue.category, issue.subcategory, issue.finding].filter(Boolean).join(' · ')
    : 'No diagnosis';
  const blocked = Boolean(row.review_block);
  const decideDisabled = busy || blocked;
  const blockTip = row.review_block ?? '';
  return (
    <li
      className={styles.row}
      data-current={current ? '' : undefined}
      data-linked={linked ? '' : undefined}
      data-correction-row={row.id}
      data-status={row.status}
    >
      <Checkbox
        isSelected={selected}
        onChange={onToggleSelected}
        aria-label={`Select diagnosis ${row.id}`}
        hideLabel
        className={styles.check}
      />
      <button
        type="button"
        className={styles.main}
        onClick={onSelectRow}
        aria-current={current ? 'true' : undefined}
        data-review-card
        tabIndex={current ? 0 : -1}
        data-testid={`row-${row.id}`}
      >
        <span className={styles.top}>
          <span className={styles.id}>#{row.id}</span>
          <span className={styles.item}>{row.item_id}</span>
          <ReviewStatusMark status={row.status} />
          {priority ? (
            <Tag tone={priority.level === 'high' ? 'danger' : 'warning'}>
              {priority.level === 'high' ? 'High' : 'Medium'}
            </Tag>
          ) : null}
          {linked ? <Tag tone="info">Linked</Tag> : null}
          {row.self_reviewed ? <Tag>Self-approved</Tag> : null}
          {row.has_reasoning ? <Tag tone="info">reasoning</Tag> : null}
          {typeof row.ai_confidence === 'number' ? (
            <span className={styles.conf}>{Math.round(row.ai_confidence * 100)}%</span>
          ) : null}
        </span>
        <span className={styles.summary} {...textDirAttrs(summary)}>
          {summary}
        </span>
        <span className={styles.ctx}>
          {showProject ? <span>{row.project_name}</span> : null}
          <TaskTag name={row.task} />
          <DatasetTag name={row.dataset} />
          {row.model ? (
            <ModelTag
              name={row.model}
              reasoning={!!row.has_reasoning}
              series={modelSeriesOf(modelIndex, row.model, !!row.has_reasoning)}
            />
          ) : null}
        </span>
      </button>
      <span className={styles.actions}>
        {row.status === 'pending' ? (
          <>
            <Tooltip content={blocked ? blockTip : 'Approve'}>
              <IconButton
                label={`Approve diagnosis ${row.id}`}
                icon="check"
                tone="approve"
                isDisabled={decideDisabled}
                onPress={onApprove}
              />
            </Tooltip>
            <Tooltip content={blocked ? blockTip : REJECT_TIP}>
              <IconButton
                label={`Reject diagnosis ${row.id}`}
                icon="close"
                tone="reject"
                isDisabled={decideDisabled}
                onPress={onReject}
              />
            </Tooltip>
          </>
        ) : (
          <Tooltip content={blocked ? blockTip : 'Reset to pending'}>
            <IconButton
              label={`Reset diagnosis ${row.id}`}
              icon="retry"
              isDisabled={decideDisabled}
              onPress={onReset}
            />
          </Tooltip>
        )}
      </span>
    </li>
  );
}
