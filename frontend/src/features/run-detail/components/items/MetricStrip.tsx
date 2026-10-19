/** Judge metadata of a metric (reason, explanation, label, scalars, objects), the edited badge and the edit helpers the metric detail uses. */
import { useMemo, useState } from 'react';
import { useUpdateMetric } from '@/api/runs';
import { humanizeKey } from '@/lib/humanizeKey';
import { textDirAttrs } from '@/lib/text';
import { isInternalMetaKey, metricMetaDisplayKey } from '@/lib/metrics';
import { Button, DataTable, IconButton, StructuredValue, Tag, TextBlock, useToast, type Column } from '@/ui';
import { TABLE_PAGE, TABLE_ROW_CAP, detectTable, type DetectedTable } from '../../lib/metricTables';
import { itemMetadataDisplayValue } from '../../lib/rowMeta';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { messageFor } from './ScoreEditor';
import styles from './MetricStrip.module.css';

export function useCanEdit(row: Row): boolean {
  const { readOnly, scoresLocked, payload } = useRunPage();
  return !readOnly && !scoresLocked && !payload.run.items_restricted && String(row.status) !== 'not_received';
}

const PROSE_KEYS = ['reason', 'reasoning', 'explanation', 'label'];
const FACT_MAX = 60;

type Cell = string | number | boolean | null;

/** One table of the detail panel: an eyebrow (humanized key, row count) over a sortable embedded DataTable. */
function DetailTable({ title, rawKey, table }: { title: string; rawKey: string; table: DetectedTable }) {
  const [all, setAll] = useState(false);
  const shown = all ? table.rows : table.rows.slice(0, TABLE_PAGE);
  const columns = useMemo<Column<Record<string, Cell>>[]>(
    () =>
      table.columns.map((c, i) => {
        const values = table.rows.map((r) => r[c]);
        const numeric =
          values.every((v) => v === null || typeof v === 'number') && values.some((v) => v !== null);
        const longest = Math.max(c.length, ...values.map((v) => String(v ?? '').length));
        const long = !numeric && longest > 36;
        return {
          id: c,
          header: humanizeKey(c),
          label: humanizeKey(c),
          sort: c,
          accessor: (r) => r[c],
          align: numeric ? 'end' : 'start',
          mono: numeric,
          flex: long && table.columns.findIndex((x) => x === c) === i,
          minWidth: long ? 200 : 72,
          width: long ? undefined : numeric ? 88 : Math.min(200, Math.max(88, longest * 7 + 24)),
          wrap: longest > 70 ? 3 : undefined,
          cell: (r) => <span dir="auto">{r[c] === null || r[c] === undefined ? '—' : String(r[c])}</span>,
        };
      }),
    [table],
  );
  return (
    <div className={styles.tableBlock} data-part="table-block" data-key={rawKey}>
      <div className={styles.eyebrowRow}>
        <span className={styles.eyebrow} title={rawKey}>
          {title}
        </span>
        <span className={styles.muted}>{table.total === 1 ? '1 row' : `${table.total} rows`}</span>
      </div>
      <DataTable<Record<string, Cell>>
        aria-label={title}
        columns={columns}
        rows={shown}
        rowKey={(r) => String(table.rows.indexOf(r))}
        density="compact"
        densityLocked
        columnMenu={false}
        zebra={false}
        variant="embedded"
        stickyHeader={false}
        responsive="scroll"
      />
      {table.rows.length > TABLE_PAGE && !all ? (
        <Button size="sm" variant="ghost" className={styles.moreRows} onPress={() => setAll(true)}>
          {`Show ${table.rows.length - TABLE_PAGE} more rows`}
        </Button>
      ) : null}
      {table.total > TABLE_ROW_CAP && (all || table.rows.length <= TABLE_PAGE) ? (
        <span className={styles.muted}>{`Showing the first ${TABLE_ROW_CAP} of ${table.total} rows`}</span>
      ) : null}
    </div>
  );
}

/**
 * The body of the metric detail panel (round 5 R3): prose blocks with the label stacked above the text, facts as key / value
 * rows (the key as written, wrapped; round 7 D2), tables for table-shaped values, collapsed key rows for everything else.
 */
export function MetricDetailBody({ meta, hidden }: { meta: Record<string, unknown>; hidden: Set<string> }) {
  const entries = Object.entries(meta).filter(
    ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
  );
  if (!entries.length)
    return <div className={styles.metaEmpty}>No details were recorded for this metric.</div>;
  const name = (k: string) => metricMetaDisplayKey(k, meta);
  const isObj = ([, v]: [string, unknown]) => v !== null && typeof v === 'object';
  const prose = entries.filter(
    ([k, v]) =>
      !isObj([k, v]) && (PROSE_KEYS.includes(name(k)) || (typeof v === 'string' && v.length > FACT_MAX)),
  );
  prose.sort(
    (a, b) => (PROSE_KEYS.indexOf(name(a[0])) + 1 || 99) - (PROSE_KEYS.indexOf(name(b[0])) + 1 || 99),
  );
  const facts = entries.filter((e) => !isObj(e) && !prose.includes(e));
  const nested = entries.filter(isObj);
  const tables = nested
    .map(([k, v]) => [k, detectTable(v)] as const)
    .filter((e): e is [string, DetectedTable] => !!e[1]);
  const trees = nested.filter(([k]) => !tables.some(([t]) => t === k));
  const treeValue = Object.fromEntries(trees);
  return (
    <div className={styles.metaBody} data-part="detail-body">
      {prose.map(([k, v], i) => (
        <div key={k} className={styles.prose} data-part="prose" data-key={k}>
          <div className={styles.eyebrow} data-part="eyebrow" title={k}>
            {humanizeKey(name(k))}
          </div>
          <div className={styles.proseText} data-part="prose-text" data-primary={i === 0 ? '' : undefined}>
            <TextBlock text={String(v)} mode={undefined} className={styles.proseInner} />
          </div>
        </div>
      ))}
      {facts.length ? (
        <dl className={styles.facts} data-part="facts" aria-label="Judge metadata">
          {facts.map(([k, v]) => {
            const text = itemMetadataDisplayValue(v);
            const mono = typeof v === 'number' || typeof v === 'boolean';
            return (
              <div key={k} className={styles.fact}>
                {/* a judge key is a data key: shown as written (exact case), wrapped in its column, never cut */}
                <dt data-part="key">
                  <span {...textDirAttrs(name(k))}>{name(k)}</span>
                </dt>
                <dd data-part="value" data-mono={mono ? '' : undefined} {...(mono ? {} : textDirAttrs(text))}>
                  {text}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {tables.map(([k, t]) => (
        <DetailTable key={k} title={humanizeKey(name(k))} rawKey={k} table={t} />
      ))}
      {trees.length ? (
        <StructuredValue value={treeValue} label="Nested details" variant="keys" toolbar={false} />
      ) : null}
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
