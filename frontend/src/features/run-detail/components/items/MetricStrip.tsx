/** One chip per metric: value, judge metadata disclosure, edit pencil, edited badge (brief 04 §3j). */
import { useState } from 'react';
import { useUpdateMetric } from '@/api/runs';
import { isInternalMetaKey, metricMetaDisplayKey } from '@/lib/metrics';
import {
  Collapse,
  FieldRow,
  Icon,
  IconButton,
  KeyValueGrid,
  ScoreValue,
  StructuredValue,
  Tag,
  TextBlock,
  useToast,
} from '@/ui';
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

const PROSE_KEYS = ['reason', 'explanation', 'label'];

/** Judge metadata of one metric: reason, explanation and label as full-width rows, scalars in a grid, objects collapsed. */
export function MetaList({ meta, hidden }: { meta: Record<string, unknown>; hidden: Set<string> }) {
  const entries = Object.entries(meta).filter(
    ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
  );
  if (!entries.length) return <div className={styles.metaEmpty}>No judge metadata recorded.</div>;
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
        <FieldRow key={k} label={name(k)} text={String(v)}>
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
        <FieldRow key={k} label={name(k)} measure="full">
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

export interface MetricChipsProps {
  /** The row the editor writes to. */
  row: Row;
  /** The row whose metric values and meta are shown (the pass-scoped row in a pass column). */
  scoped: Row;
  /** Pass the values belong to (null: the single/final view). */
  pass: number | null;
  /** Show the edited badge with its reset action (single view only). */
  canReset?: boolean;
  canEdit: boolean;
  label?: string;
}

/**
 * Metric chips: a wrapping row of outlined chips (caret, name, value, pencil). A chip with judge metadata toggles
 * a detail panel under the row that takes the full width; several can be open at once, in chip order. The score
 * editor opens in the same panel slot.
 */
export function MetricChips({
  row,
  scoped,
  pass,
  canReset = false,
  canEdit,
  label = 'Metrics',
}: MetricChipsProps) {
  const { model, api, runId, payload } = useRunPage();
  const ui = useItemsUi();
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const suffix = pass ? ` for pass ${pass}` : '';
  const toggle = (metric: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(metric)) n.delete(metric);
      else n.add(metric);
      return n;
    });
  const cells = model.metricNames.map((metric) => {
    const cell = metricCell(api.ctx, scoped, metric);
    const meta = (scoped.metric_meta?.[metric] ?? {}) as Record<string, unknown>;
    return { metric, cell, meta, detail: hasMetaDetail(meta, ui.hiddenMetricFields) };
  });
  return (
    <div className={styles.metrics} data-pass={pass ?? undefined}>
      <div className={styles.strip} role="list" aria-label={label}>
        {cells.map(({ metric, cell, meta, detail }) => {
          const isOpen = open.has(metric) || editing === metric;
          const direction = model.metricDirections[metric];
          const nameTitle =
            direction === 'minimize'
              ? 'Lower is better'
              : direction === 'maximize'
                ? 'Higher is better'
                : undefined;
          const body = (
            <>
              {detail ? (
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} className={styles.caret} />
              ) : null}
              <span className={styles.name} title={nameTitle}>
                {metric}
              </span>
              <ScoreValue
                value={cell.value}
                type={cell.type}
                direction={cell.direction}
                error={cell.error}
                text={cell.text}
              />
            </>
          );
          return (
            <div
              key={metric}
              role="listitem"
              className={styles.chip}
              data-metric={metric}
              data-pass={pass ?? undefined}
              data-open={isOpen || undefined}
              data-selected={metric === api.selectedMetric || undefined}
            >
              {detail ? (
                <button
                  type="button"
                  className={styles.chipMain}
                  aria-expanded={open.has(metric)}
                  aria-controls={`metric-panel-${row.item_id}-${pass ?? 0}-${metric}`}
                  aria-label={`${open.has(metric) ? 'Hide' : 'Show'} ${metric} details${suffix}`}
                  onClick={() => toggle(metric)}
                >
                  {body}
                </button>
              ) : (
                <span className={styles.chipMain} data-static="">
                  {body}
                </span>
              )}
              {cell.edited ? (
                canReset ? (
                  <EditedBadge row={row} metric={metric} meta={meta} canEdit={canEdit} />
                ) : (
                  <Tag tone="warning" title={editTooltip(meta)}>
                    edited
                  </Tag>
                )
              ) : null}
              {canEdit ? (
                <IconButton
                  label={`Edit ${metric} score${suffix}`}
                  icon="edit"
                  onPress={() => setEditing(editing === metric ? null : metric)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {cells.map(({ metric, cell, meta, detail }) => {
        const isEditing = editing === metric;
        const isOpen = detail && open.has(metric);
        return (
          <Collapse key={metric} open={isEditing || isOpen}>
            <section
              id={`metric-panel-${row.item_id}-${pass ?? 0}-${metric}`}
              className={styles.panel}
              aria-label={`${isEditing ? 'Edit' : ''} ${metric} details${suffix}`.trim()}
              data-metric={metric}
              data-pass={pass ?? undefined}
            >
              <header className={styles.panelHead}>
                <span className={styles.panelTitle}>{isEditing ? `Edit ${metric}` : metric}</span>
              </header>
              {isEditing ? (
                <ScoreEditor
                  runId={runId}
                  filePath={payload.run.file_path ?? payload.run.run_id}
                  row={row}
                  metric={metric}
                  spec={model.metricSpecs[metric]}
                  initial={
                    cell.value === null
                      ? ''
                      : cell.type === 'score'
                        ? String(Math.round(cell.value * 1000) / 10) + '%'
                        : String(cell.value)
                  }
                  passNumber={pass}
                  passVersion={model.passRevision}
                  edited={cell.edited}
                  onDone={() => setEditing(null)}
                />
              ) : (
                <MetaList meta={meta} hidden={ui.hiddenMetricFields} />
              )}
            </section>
          </Collapse>
        );
      })}
    </div>
  );
}

export function MetricStrip({ row }: { row: Row }) {
  const { model } = useRunPage();
  const canEdit = useCanEdit(row);
  const repeatAggregate = model.isRepeat && !model.viewPass;
  return (
    <MetricChips
      row={row}
      scoped={row}
      pass={model.viewPass}
      canReset
      canEdit={canEdit && !repeatAggregate}
    />
  );
}
