import { forwardRef, useState, type FormEvent } from 'react';
import { textDirAttrs } from '@/lib/text';
import type { Row, RunInfo } from '../types';
import { formatLatency } from '../lib/stats';
import { metricCell } from '../lib/metric-cell';
import { wordDiff } from '../lib/diff';
import { copyText, STATUS_LABEL } from './format';
import { Badge } from '@/ui/Badge';
import { StatusBadge } from './StatusBadge';
import s from './Detail.module.css';

const LONG = 700;

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <button
      type="button"
      className={s.link}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        setState((await copyText(text)) ? 'done' : 'failed');
        window.setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

function Block({ label, text, children }: { label: string; text: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={s.block}>
      <div className={s.blockHead}>
        <h3 className={s.label}>{label}</h3>
        <CopyBtn text={text} label={label.toLowerCase()} />
        {text.length > LONG ? (
          <button type="button" className={s.link} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Collapse' : 'Show all'}
          </button>
        ) : null}
      </div>
      <pre
        className={s.text}
        data-open={open || undefined}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be keyboard reachable
        tabIndex={0}
        aria-label={label}
        {...textDirAttrs(text)}
      >
        {children ?? (text || '—')}
      </pre>
    </section>
  );
}

function ScoreEditor({
  name,
  value,
  disabled,
  onSave,
}: {
  name: string;
  value: string | number | undefined;
  disabled: boolean;
  onSave: (score: string) => Promise<void>;
}) {
  const cell = metricCell(value);
  const initial = cell.num === null ? '' : String(cell.num);
  const [draft, setDraft] = useState(initial);
  // The stored score changed under us (our own save, via the refreshed row): show it.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setDraft(initial);
  }
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({
    kind: 'idle',
  });
  const dirty = draft.trim() !== initial && draft.trim() !== '';
  const valid = draft.trim() === '' || Number.isFinite(Number(draft));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !valid) return;
    setStatus({ kind: 'saving' });
    try {
      await onSave(draft.trim());
      setStatus({ kind: 'saved' });
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    }
  };
  return (
    <form className={s.edit} onSubmit={submit}>
      <label className={s.editLabel}>
        <span>New score</span>
        <input
          className={s.input}
          inputMode="decimal"
          placeholder="n/a"
          value={draft}
          disabled={disabled}
          aria-invalid={!valid || undefined}
          aria-label={`New ${name} score`}
          onChange={(e) => {
            setDraft(e.target.value);
            setStatus({ kind: 'idle' });
          }}
        />
      </label>
      <button
        type="submit"
        className={s.btn}
        disabled={disabled || !dirty || !valid || status.kind === 'saving'}
      >
        {status.kind === 'saving' ? 'Saving' : 'Save'}
      </button>
      {dirty ? (
        <button type="button" className={s.btn} onClick={() => setDraft(initial)}>
          Cancel
        </button>
      ) : null}
      <span className={s.editStatus} role="status" data-kind={status.kind}>
        {status.kind === 'saved'
          ? 'Saved to the results file'
          : status.kind === 'error'
            ? status.text
            : !valid
              ? 'Enter a number'
              : ''}
      </span>
    </form>
  );
}

export interface DetailProps {
  row: Row;
  metricNames: string[];
  run: RunInfo;
  canEdit: boolean;
  onClose: () => void;
  onSaveScore: (rowIndex: number, metric: string, score: string) => Promise<void>;
}

export const Detail = forwardRef<HTMLElement, DetailProps>(function Detail(
  { row, metricNames, run, canEdit, onClose, onSaveScore },
  ref,
) {
  const [diff, setDiff] = useState(false);
  const failed = row.status === 'error';
  const showDiff = diff && !failed && row.expected_full !== '';
  const parts = showDiff ? wordDiff(row.expected_full, row.output_full) : null;
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape from any child closes the pane
    <article
      ref={ref}
      tabIndex={-1}
      className={s.detail}
      aria-labelledby="detail-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={s.head}>
        <h2 id="detail-title" className={s.title}>
          Row {row.index + 1}
        </h2>
        <StatusBadge status={row.status} />
        <span className={s.grow} />
        <label className={s.check}>
          <input type="checkbox" checked={diff} onChange={(e) => setDiff(e.target.checked)} /> Show diff
        </label>
        <button type="button" className={s.btn} onClick={onClose} aria-label="Close row detail (Escape)">
          Close
        </button>
      </div>
      {failed ? (
        <div className={s.error} role="alert">
          <strong>{STATUS_LABEL.error}.</strong> {row.output_full || 'The task failed without a message.'}
        </div>
      ) : null}
      <Block label="Input" text={row.input_full} />
      {failed ? null : (
        <Block label="Output" text={row.output_full}>
          {parts
            ? parts.map((p, i) =>
                p.type === 'same' ? (
                  p.text
                ) : p.type === 'ins' ? (
                  <ins key={i} className={s.ins}>
                    {p.text}
                  </ins>
                ) : null,
              )
            : undefined}
        </Block>
      )}
      <Block label="Expected" text={row.expected_full}>
        {parts
          ? parts.map((p, i) =>
              p.type === 'same' ? (
                p.text
              ) : p.type === 'del' ? (
                <del key={i} className={s.del}>
                  {p.text}
                </del>
              ) : null,
            )
          : undefined}
      </Block>
      <section className={s.block}>
        <h3 className={s.label}>Metrics</h3>
        <ul className={s.metrics}>
          {metricNames.map((name, k) => {
            const cell = metricCell(row.metric_values[k]);
            const allMeta = row.metric_meta[name] ?? {};
            const edited = allMeta.modified === 'true';
            const original = allMeta.original_score;
            // modified / original_score are audit columns, shown as the Edited badge instead.
            const meta = Object.entries(allMeta).filter(
              ([key, v]) => String(v).trim() !== '' && key !== 'modified' && key !== 'original_score',
            );
            return (
              <li key={name}>
                <div className={s.metricRow}>
                  <span className={s.metricName}>{name}</span>
                  <span className={s.score} data-kind={cell.kind}>
                    {cell.text || '—'}
                  </span>
                  {edited ? <Badge tone="info">Edited</Badge> : null}
                </div>
                {edited && original ? <p className={s.meta}>Original: {original}</p> : null}
                {meta.map(([key, value]) => (
                  <p key={key} className={s.meta} {...textDirAttrs(value)}>
                    <span className={s.metaKey}>{key}</span> {value}
                  </p>
                ))}
                {canEdit && !failed ? (
                  <ScoreEditor
                    key={`${row.index}:${name}`}
                    name={name}
                    value={row.metric_values[k]}
                    disabled={false}
                    onSave={(score) => onSaveScore(row.index, name, score)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        {!canEdit && run.file_path && run.editable === false ? (
          <p className={s.note}>
            Scores in this file are read-only: only <code>.csv</code> files inside the viewer&apos;s results
            folder can be edited.
          </p>
        ) : null}
        {canEdit ? (
          <p className={s.note}>
            Saving writes the score into <code>{run.file_path?.split(/[\\/]/).pop()}</code> and keeps the
            original in an audit column.
          </p>
        ) : null}
      </section>
      <dl className={s.facts}>
        <div>
          <dt>Latency</dt>
          <dd>{formatLatency(row.latency_ms)}</dd>
        </div>
        <div>
          <dt>Trace</dt>
          <dd>
            {row.trace_id ? (
              <>
                {row.trace_id} <CopyBtn text={row.trace_id} label="trace id" />
                {row.trace_url && /^https?:\/\//i.test(row.trace_url) ? (
                  <a className={s.link} href={row.trace_url} target="_blank" rel="noreferrer noopener">
                    Open trace
                  </a>
                ) : null}
              </>
            ) : row.trace_url && /^https?:\/\//i.test(row.trace_url) ? (
              <a className={s.link} href={row.trace_url} target="_blank" rel="noreferrer noopener">
                Open trace
              </a>
            ) : (
              '—'
            )}
          </dd>
        </div>
        {row.item_id ? (
          <div>
            <dt>Item</dt>
            <dd>{row.item_id}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  );
});
