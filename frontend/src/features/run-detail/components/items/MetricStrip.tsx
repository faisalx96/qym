/** Judge metadata of a metric (reason, explanation, label, scalars, objects), the edited badge and the edit helpers the metric detail uses. */
import { useUpdateMetric } from '@/api/runs';
import { isInternalMetaKey, metricMetaDisplayKey } from '@/lib/metrics';
import { FieldRow, IconButton, KeyValueGrid, StructuredValue, Tag, TextBlock, useToast } from '@/ui';
import { itemMetadataDisplayValue } from '../../lib/rowMeta';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { messageFor } from './ScoreEditor';
import styles from './MetricStrip.module.css';

export function useCanEdit(row: Row): boolean {
  const { readOnly, scoresLocked, payload } = useRunPage();
  return !readOnly && !scoresLocked && !payload.run.items_restricted && String(row.status) !== 'not_received';
}

const PROSE_KEYS = ['reason', 'explanation', 'label'];

/** Judge metadata of one metric: reason, explanation and label as full-width rows, scalars in a grid, objects collapsed. */
export function MetaList({ meta, hidden }: { meta: Record<string, unknown>; hidden: Set<string> }) {
  const entries = Object.entries(meta).filter(
    ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
  );
  if (!entries.length)
    return <div className={styles.metaEmpty}>No details were recorded for this metric.</div>;
  const name = (k: string) => metricMetaDisplayKey(k, meta);
  const isObj = ([, v]: [string, unknown]) => v !== null && typeof v === 'object';
  const prose = entries.filter(
    ([k, v]) => !isObj([k, v]) && (PROSE_KEYS.includes(name(k)) || (typeof v === 'string' && v.length > 60)),
  );
  prose.sort(
    (a, b) => (PROSE_KEYS.indexOf(name(a[0])) + 1 || 99) - (PROSE_KEYS.indexOf(name(b[0])) + 1 || 99),
  );
  const scalars = entries.filter((e) => !isObj(e) && !prose.includes(e));
  const objects = entries.filter(isObj);
  return (
    <div className={styles.metaBody}>
      {prose.map(([k, v]) => (
        <FieldRow key={k} label={name(k)} text={String(v)} labelAnchor="start">
          <TextBlock text={String(v)} mode={undefined} />
        </FieldRow>
      ))}
      {scalars.length ? (
        <KeyValueGrid
          columns={3}
          dense
          aria-label="Judge metadata"
          items={scalars.map(([k, v]) => ({
            key: k,
            label: name(k),
            value: itemMetadataDisplayValue(v),
            mono: typeof v === 'number' || typeof v === 'boolean',
          }))}
        />
      ) : null}
      {objects.map(([k, v]) => (
        <FieldRow key={k} label={name(k)} measure="full" labelAnchor="start">
          <StructuredValue value={v} label={name(k)} defaultOpen="none" toolbar={false} />
        </FieldRow>
      ))}
    </div>
  );
}

/** True when a metric has metadata worth a detail panel. */
export function hasMetaDetail(meta: Record<string, unknown>, hidden: Set<string>): boolean {
  return Object.entries(meta).some(
    ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
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

export function EditedBadge({
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
