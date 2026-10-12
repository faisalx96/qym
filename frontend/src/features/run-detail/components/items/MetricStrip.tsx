/** One chip per metric: value, judge metadata disclosure, edit pencil, edited badge (brief 04 §3j). */
import { useState } from 'react';
import { isInternalMetaKey, metricMetaDisplayKey } from '@/lib/metrics';
import { Icon, IconButton, JsonPreview, ScoreValue, Tag } from '@/ui';
import { itemMetadataDisplayValue } from '../../lib/rowMeta';
import { metricCell } from '../../lib/rowDisplay';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { useItemsUi } from './ItemsUi';
import { ScoreEditor } from './ScoreEditor';
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
                <Tag
                  kind="accent"
                  tone="warning"
                  title={`Edited${meta.original_score !== undefined ? `; scorer value ${String(meta.original_score)}` : ''}`}
                >
                  edited
                </Tag>
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
