/**
 * The metrics of an item as one table: name, score (one column per pass and the mean for a multi-pass item), the pass
 * threshold and the reason. In a narrow pane the reason goes under its metric. What a scorer recorded beside the reason
 * (its model, a rubric, a table of mismatches) shows under the metric over the full width of the table: short facts
 * first, then text, then tables. The details are closed until the reader opens one metric or all of them.
 */
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { keyWithBreaks } from '@/lib/keyBreaks';
import { SCORE_EDIT_HINTS, isInternalMetaKey, type MetricSpec } from '@/lib/metrics';
import { readLocal, writeLocal } from '@/lib/storage';
import { textDirAttrs } from '@/lib/text';
import { Icon, ScoreValue, StateTag, Tag } from '@/ui';
import { useRunPage } from '../../../RunContext';
import type { Row } from '../../../types';
import { ScoreEditor } from '../ScoreEditor';
import { Act } from './actions';
import { PaneSection } from './blocks';
import { editTooltip, extraMeta, metaOf, reasonOf, type ItemData, type MetricRow } from './model';
import { FieldList } from './values';
import s from './pane.module.css';

/* ---------- the "details open" preference (one for every pane) ---------- */

const DETAILS_KEY = 'qym:item-pane:details';
const detailSubs = new Set<() => void>();
let detailMemory: boolean | null = null;

export function useDetailsOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    (f) => {
      detailSubs.add(f);
      return () => detailSubs.delete(f);
    },
    () => detailMemory ?? readLocal(DETAILS_KEY) === 'open',
  );
  const set = (next: boolean) => {
    detailMemory = next;
    writeLocal(DETAILS_KEY, next ? 'open' : null);
    detailSubs.forEach((f) => f());
  };
  return [open, set];
}

/** What a judge recorded beside the reason, without the platform's own bookkeeping keys. */
export function detailsOf(meta: Record<string, unknown>, hidden: Set<string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(extraMeta(meta)).filter(
      ([k, v]) => !isInternalMetaKey(k) && !hidden.has(k) && v !== null && v !== undefined && v !== '',
    ),
  );
}

export function initialFor(cell: MetricRow['cells'][number]): string {
  if (cell.value === null) return '';
  if (cell.type === 'score') return String(Math.round(cell.value * 1000) / 10) + '%';
  if (cell.type === 'boolean')
    return cell.value >= 0.9999 ? 'true' : cell.value <= 0.0001 ? 'false' : String(cell.value);
  return String(cell.value);
}

export function Score({ cell, verdict }: { cell: MetricRow['cells'][number]; verdict: boolean | null }) {
  return (
    <ScoreValue
      variant="plain"
      value={cell.value}
      type={cell.type}
      direction={cell.direction}
      error={cell.error}
      text={cell.text}
      verdict={verdict === null ? null : verdict ? 'pass' : 'fail'}
      className={s.score}
    />
  );
}

/* ---------- score edit ---------- */

/** What the score field takes, by the kind of the metric: one quiet line under the platform's score editor. */
export function ScoreHint({ spec }: { spec: MetricSpec | undefined }) {
  const kind = spec?.score_type && spec.score_type in SCORE_EDIT_HINTS ? spec.score_type : 'legacy';
  return <p className={s.hint}>{SCORE_EDIT_HINTS[kind]}</p>;
}

/** The platform's score editor (same request, same checks, same buttons) with the hint line of the pane. */
export function ScoreEdit({
  row,
  item,
  metric,
  spec,
  initial,
  passNumber,
  edited,
  onDone,
}: {
  row: Row;
  item: ItemData;
  metric: string;
  spec: MetricSpec | undefined;
  initial: string;
  passNumber: number | null;
  edited: boolean;
  onDone: () => void;
}) {
  const { payload } = useRunPage();
  return (
    <div className={s.edit}>
      <ScoreEditor
        runId={item.runId}
        filePath={payload.run.file_path ?? payload.run.run_id}
        row={row}
        metric={metric}
        spec={spec}
        initial={initial}
        passNumber={passNumber}
        passVersion={item.model.passRevision}
        edited={edited}
        onDone={onDone}
      />
      <ScoreHint spec={spec} />
    </div>
  );
}

/* ---------- the table ---------- */

export interface MetricsProps {
  row: Row;
  item: ItemData;
  focus: number;
  onFocus: (pass: number) => void;
}

export function MetricTable({ row, item, focus, onFocus }: MetricsProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useDetailsOpen();
  // a metric closed or opened on its own, until the header switch moves them all again
  const [own, setOwn] = useState<Record<string, boolean>>({});
  const { passes, multi } = item;
  const fi = Math.max(
    0,
    passes.findIndex((p) => p.pass === focus),
  );
  const focusPass = passes[fi]!;
  // every pass has its own column while they fit; beyond that the pass in view and the mean
  const allPasses = multi && passes.length <= 4;
  const scoreColumns = multi ? (allPasses ? passes.length : 1) + 1 : 1;
  const none = item.restricted || item.noScores;
  const hidden = item.ui.hiddenMetricFields;

  const rows = item.metrics.map((m) => {
    const meta = metaOf(focusPass.scoped, m.metric);
    return {
      m,
      meta,
      details: detailsOf(meta, hidden),
      cell: m.cells[fi]!,
      failing: m.verdicts[fi] === false,
    };
  });
  const withDetails = rows.filter((r) => Object.keys(r.details).length > 0);
  const anyDetails = withDetails.length > 0;
  const isOpen = (metric: string) => own[metric] ?? detailsOpen;
  const allOpen = withDetails.every((r) => isOpen(r.m.metric));
  const below = rows.filter((r) => r.failing).length;
  // a column shows only when a metric has something for it: a pass threshold, a reason (or a scorer error to report)
  const anyPassIf = rows.some((r) => r.m.passIf);
  const anyReason = rows.some((r) => reasonOf(r.meta) || r.cell.error) && !focusPass.taskError;
  // a pass whose task failed has no reasons: the block says so once, the Output block shows the error
  const taskError = focusPass.taskError ? 'Task error' : null;

  const head: ReactNode = (
    <div className={s.mhead} role="row">
      <span role="columnheader" className={s.mtitle}>
        Metric
      </span>
      {none ? null : (
        <>
          {multi ? (
            <>
              {allPasses ? (
                passes.map((p) => (
                  <span key={p.pass} role="columnheader" data-center="">
                    <button
                      type="button"
                      className={s.passHead}
                      aria-pressed={p.pass === focus}
                      title={`Pass ${p.pass}: ${p.label}. Show its reasons and output`}
                      onClick={() => onFocus(p.pass)}
                    >
                      Pass {p.pass}
                      <span className={s.passGlyph} data-kind={p.kind} aria-hidden="true">
                        <Icon name={p.kind === 'pass' ? 'check' : 'close'} size={12} />
                      </span>
                    </button>
                  </span>
                ))
              ) : (
                <span role="columnheader" data-center="">
                  Pass {focus}
                </span>
              )}
              <span role="columnheader" data-center="">
                Mean
              </span>
            </>
          ) : (
            <span role="columnheader" data-center="">
              Score
            </span>
          )}
          {anyPassIf ? (
            <span role="columnheader" data-center="">
              Pass if
            </span>
          ) : null}
          {anyReason ? (
            <span role="columnheader" className={s.reasonHead}>
              {multi ? `Reason, pass ${focus}` : 'Reason'}
            </span>
          ) : null}
          <span role="columnheader" className={s.actionCell}>
            {anyDetails ? (
              <Act
                label={allOpen ? 'Hide the details of every metric' : 'Show the details of every metric'}
                icon={allOpen ? 'collapse' : 'expand'}
                aria-expanded={allOpen}
                onPress={() => {
                  setDetailsOpen(!allOpen);
                  setOwn({});
                }}
              />
            ) : null}
          </span>
        </>
      )}
    </div>
  );

  return (
    <PaneSection
      title="Metrics"
      part="metrics-section"
      description={
        // a result is a StateTag; a problem count is a count tag in its tone (§3.3)
        none ? null : taskError ? (
          <StateTag tone="danger">{taskError}</StateTag>
        ) : below ? (
          <Tag kind="count" tone="danger" data-count="failed">
            {below} failed
          </Tag>
        ) : null
      }
    >
      <section className={s.block} data-tone="neutral" data-part="metrics" aria-label="Metrics">
        <div
          className={s.mgrid}
          data-multi={multi && allPasses ? '' : undefined}
          data-noreason={anyReason ? undefined : ''}
          role="table"
          aria-label="Metrics"
          style={{
            ['--scores' as string]: scoreColumns,
            // an empty value takes the column out of the grid
            ['--c-passif' as string]: anyPassIf ? '64px' : ' ',
            ['--c-reason' as string]: anyReason ? 'minmax(0, 2fr)' : ' ',
          }}
        >
          {head}
          {none ? (
            <p className={s.mnone}>
              {item.restricted
                ? 'Scores are hidden for this run'
                : 'No scores: this item gave no output to score'}
            </p>
          ) : (
            rows.map(({ m, meta, details, cell, failing }) => {
              const text = reasonOf(meta);
              const isEditing = editing === m.metric;
              const fallback = cell.error ? 'The scorer failed on this metric' : 'No reason was recorded';
              const hasDetails = Object.keys(details).length > 0 && !focusPass.taskError;
              const open = hasDetails && isOpen(m.metric);
              return (
                <div
                  key={m.metric}
                  className={s.mrow}
                  role="row"
                  data-failing={failing ? '' : undefined}
                  data-editing={isEditing ? '' : undefined}
                >
                  <span role="cell" className={s.nameCell}>
                    <span
                      className={s.metricName}
                      data-page={m.isPage ? '' : undefined}
                      title={m.isPage ? 'The page metric: it decides Pass or Fail' : undefined}
                    >
                      {keyWithBreaks(m.metric)}
                    </span>
                    {cell.edited ? (
                      <Tag kind="accent" tone="warning" title={editTooltip(meta)}>
                        edited
                      </Tag>
                    ) : null}
                  </span>
                  {multi ? (
                    <>
                      {(allPasses ? passes.map((_, i) => i) : [fi]).map((i) => (
                        <span key={i} role="cell" data-center="">
                          <span className={s.cellScore} data-focus={i === fi && allPasses ? '' : undefined}>
                            <Score cell={m.cells[i]!} verdict={m.verdicts[i] ?? null} />
                          </span>
                        </span>
                      ))}
                      <span role="cell" data-center="">
                        <span className={s.cellScore}>
                          <Score cell={m.mean} verdict={m.meanVerdict} />
                        </span>
                      </span>
                    </>
                  ) : (
                    <span role="cell" data-center="">
                      <span className={s.cellScore}>
                        <Score cell={cell} verdict={m.verdicts[fi] ?? null} />
                      </span>
                    </span>
                  )}
                  {anyPassIf ? (
                    <span role="cell" data-center="" className={s.passIf}>
                      {m.passIf}
                    </span>
                  ) : null}
                  {anyReason || isEditing ? (
                    <div role="cell" className={s.reasonCell}>
                      {isEditing ? (
                        <ScoreEdit
                          row={row}
                          item={item}
                          metric={m.metric}
                          spec={item.model.metricSpecs[m.metric]}
                          initial={initialFor(cell)}
                          passNumber={multi ? focus : item.model.viewPass}
                          edited={cell.edited}
                          onDone={() => setEditing(null)}
                        />
                      ) : focusPass.taskError ? null : (
                        <p
                          className={s.reason}
                          data-strong={failing ? '' : undefined}
                          data-empty={text ? undefined : ''}
                          {...textDirAttrs(text)}
                        >
                          {text || fallback}
                        </p>
                      )}
                    </div>
                  ) : null}
                  <span role="cell" className={s.actionCell}>
                    {hasDetails ? (
                      <Act
                        label={`${open ? 'Hide' : 'Show'} the details of ${m.metric}`}
                        icon={open ? 'chevron-up' : 'chevron-down'}
                        aria-expanded={open}
                        onPress={() => setOwn((cur) => ({ ...cur, [m.metric]: !open }))}
                      />
                    ) : null}
                    {item.canEdit ? (
                      <Act
                        label={`Edit the ${m.metric} score${multi ? ` of pass ${focus}` : ''}`}
                        icon="edit"
                        active={isEditing}
                        onPress={() => setEditing(isEditing ? null : m.metric)}
                      />
                    ) : null}
                  </span>
                  {open ? (
                    <div role="cell" className={s.mdetail} data-part="metric-details">
                      <FieldList data={details} label={`Details of ${m.metric}`} detail />
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>
    </PaneSection>
  );
}
