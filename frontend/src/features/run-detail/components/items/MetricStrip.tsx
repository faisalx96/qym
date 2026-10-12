/** One chip per metric: value, judge metadata disclosure, edit pencil, edited badge (brief 04 §3j). */
import { useState } from 'react';
import { useUpdateMetric } from '@/api/runs';
import { isInternalMetaKey, metricMetaDisplayKey } from '@/lib/metrics';
import { Icon, IconButton, JsonPreview, ScoreValue, Tag, useToast } from '@/ui';
import { itemMetadataDisplayValue } from '../../lib/rowMeta';
import { metricCell } from '../../lib/rowDisplay';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { useItemsUi } from './ItemsUi';
import { messageFor, ScoreEditor } from './ScoreEditor';
import styles from './MetricStrip.module.css';

export function useCanEdit(row: Row): boolean {
  const { readOnly, scoresLocked, payload } = useRunPage();
  return !readOnly && !scoresLocked && !payload.run.items_restricted && String(row.status) !== 'not_received';
}

export function MetaList({ meta, hidden }: { meta: Record<string, unknown>; hidden: Set<string> }) {
  const entries = Object.entries(meta).filter(
    ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
  );
  if (!entries.length) return <div className={styles.metaEmpty}>No judge metadata recorded.</div>;
  return (
    <dl className={styles.metaList}>
      {entries.map(([k, v]) => (
        <div key={k} className={styles.metaRow}>
          <dt>{metricMetaDisplayKey(k, meta)}</dt>
          <dd>
            {v !== null && typeof v === 'object' ? (
              <JsonPreview value={v} title={k} compact />
            ) : (
              itemMetadataDisplayValue(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function editValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'no score';
  return String(typeof value === 'number' ? Number(value.toFixed(4)) : value);
}

/** Who edited the score, when, and from what to what (meta.last_edit), plus the scorer's original value. */
export function editTooltip(meta: Record<string, unknown>): string {
  const record =
    meta.last_edit && typeof meta.last_edit === 'object' ? (meta.last_edit as Record<string, unknown>) : null;
  const lines: string[] = [];
  if (record) {
    const when = record.at ? new Date(String(record.at)) : null;
    const whenText =
      when && !Number.isNaN(when.getTime())
        ? when.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
    lines.push(
      `${record.action === 'reset' ? 'Reset by ' : 'Edited by '}${String(record.by || 'a reviewer')}${whenText ? ` on ${whenText}` : ''}`,
    );
    lines.push(`${editValue(record.from)} \u2192 ${editValue(record.to)}`);
  } else {
    lines.push('Edited by a reviewer');
  }
  if (meta.original_score !== undefined) lines.push(`Original score: ${editValue(meta.original_score)}`);
  return lines.join('\n');
}

function EditedBadge({
  row,
  metric,
  meta,
  canEdit,
}: {
  row: Row;
  metric: string;
  meta: Record<string, unknown>;
  canEdit: boolean;
}) {
  const { runId, model, payload } = useRunPage();
  const toast = useToast();
  const mutation = useUpdateMetric(runId);
  const original = meta.original_score !== undefined ? ` (${editValue(meta.original_score)})` : '';
  const passNumber = model.viewPass;
  const reset = () =>
    mutation.mutate(
      {
        file_path: payload.run.file_path ?? payload.run.run_id,
        row_index: row.index,
        metric_name: metric,
        reset: true,
        ...(passNumber ? { pass_number: passNumber, expected_pass_version: model.passRevision } : {}),
      },
      {
        onSuccess: () => toast.show(`${metric} reset to its original score${original}.`),
        onError: (e) => toast.show(messageFor(e), { tone: 'error' }),
      },
    );
  return (
    <>
      <Tag kind="accent" tone="warning" title={editTooltip(meta)}>
        edited
      </Tag>
      {canEdit ? (
        <IconButton
          label={`Reset ${metric}${passNumber ? ` pass ${passNumber}` : ''} to its original score${original}`}
          icon="retry"
          onPress={reset}
          isDisabled={mutation.isPending}
        />
      ) : null}
    </>
  );
}

export function MetricStrip({ row }: { row: Row }) {
  const { model, api, runId, payload } = useRunPage();
  const ui = useItemsUi();
  const canEdit = useCanEdit(row);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const repeatAggregate = model.isRepeat && !model.viewPass;
  return (
    <div className={styles.strip} role="list" aria-label="Metrics">
      {model.metricNames.map((metric) => {
        const cell = metricCell(api.ctx, row, metric);
        const meta = (row.metric_meta?.[metric] ?? {}) as Record<string, unknown>;
        const spec = model.metricSpecs[metric];
        const isEditing = editing === metric;
        return (
          <div
            key={metric}
            role="listitem"
            className={styles.chip}
            data-metric={metric}
            data-selected={metric === api.selectedMetric || undefined}
          >
            <div className={styles.chipHead}>
              <button
                type="button"
                className={styles.caret}
                aria-expanded={open === metric}
                aria-label={`${open === metric ? 'Hide' : 'Show'} ${metric} details`}
                onClick={() => setOpen(open === metric ? null : metric)}
              >
                <Icon name={open === metric ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
              <span
                className={styles.name}
                title={
                  model.metricDirections[metric] === 'minimize'
                    ? 'Lower is better'
                    : model.metricDirections[metric] === 'maximize'
                      ? 'Higher is better'
                      : undefined
                }
              >
                {metric}
              </span>
              <ScoreValue
                value={cell.value}
                type={cell.type}
                direction={cell.direction}
                error={cell.error}
                text={cell.text}
              />
              {cell.edited ? (
                <EditedBadge row={row} metric={metric} meta={meta} canEdit={canEdit && !repeatAggregate} />
              ) : null}
              {canEdit && !repeatAggregate ? (
                <IconButton
                  label={`Edit ${metric} score`}
                  icon="edit"
                  onPress={() => setEditing(isEditing ? null : metric)}
                />
              ) : null}
            </div>
            {isEditing ? (
              <ScoreEditor
                runId={runId}
                filePath={payload.run.file_path ?? payload.run.run_id}
                row={row}
                metric={metric}
                spec={spec}
                initial={
                  cell.value === null
                    ? ''
                    : cell.type === 'score'
                      ? String(Math.round(cell.value * 1000) / 10) + '%'
                      : String(cell.value)
                }
                passNumber={model.viewPass}
                passVersion={model.passRevision}
                edited={cell.edited}
                onDone={() => setEditing(null)}
              />
            ) : null}
            {open === metric ? <MetaList meta={meta} hidden={ui.hiddenMetricFields} /> : null}
          </div>
        );
      })}
    </div>
  );
}
