import { useEffect, useState } from 'react';
import { CopyButton, Eyebrow, SegmentedControl, Tag, Textarea } from '@/ui';
import { textDirAttrs } from '@/lib/text';
import { evaluate, initialMode, initialText, type EditorMode, type Evaluation } from './editor';
import styles from './FieldEditor.module.css';

export interface FieldEditorProps {
  label: string;
  stored: unknown;
  /** Metadata is always a JSON object: no Text mode. */
  jsonOnly?: boolean;
  readOnly?: boolean;
  rows?: number;
  compact?: boolean;
  /** Start in JSON mode with this text (used to show the `string → number` state). */
  initial?: { mode: EditorMode; text: string };
  onEvaluate?: (e: Evaluation) => void;
  autoFocus?: boolean;
}

/** One Input / Expected / Metadata panel with the type-explicit Text/JSON editor. */
export function FieldEditor({
  label,
  stored,
  jsonOnly,
  readOnly,
  rows = 6,
  compact,
  initial,
  onEvaluate,
  autoFocus,
}: FieldEditorProps) {
  const [mode, setMode] = useState<EditorMode>(initial?.mode ?? (jsonOnly ? 'json' : initialMode(stored)));
  const [text, setText] = useState(initial?.text ?? initialText(stored));
  const ev = evaluate(stored, mode, text);
  useEffect(() => {
    onEvaluate?.(ev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, text]);
  const dir = textDirAttrs(text);
  return (
    <section className={styles.panel} data-compact={compact ? '' : undefined} aria-label={label}>
      <div className={styles.head}>
        <Eyebrow>{label}</Eyebrow>
        {ev.typeChanged && ev.nextType ? (
          <span className={styles.typeChange}>
            <Tag kind="data">{ev.storedType}</Tag>
            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
            <Tag kind="data" tone="warning">
              {ev.nextType}
            </Tag>
            <span className="sr-only">type changes from {ev.storedType} to {ev.nextType}</span>
          </span>
        ) : (
          <Tag kind="data">{ev.storedType}</Tag>
        )}
        <span className={styles.headEnd}>
          <CopyButton text={text} label={`Copy ${label}`} />
        </span>
      </div>
      {readOnly ? (
        <pre className={styles.readonly} {...dir}>
          {text}
        </pre>
      ) : (
        <Textarea
          label={label}
          hideLabel
          mono
          rows={rows}
          value={text}
          onChange={setText}
          dir={mode === 'json' ? 'ltr' : dir.dir}
          autoFocus={autoFocus}
          errorMessage={ev.valid ? undefined : 'Not valid JSON'}
        />
      )}
      {readOnly ? null : (
        <div className={styles.foot}>
          {jsonOnly ? (
            <span className={styles.status}>JSON object</span>
          ) : (
            <SegmentedControl
              label={`${label} editor mode`}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'json', label: 'JSON' },
              ]}
              value={mode}
              onChange={setMode}
            />
          )}
          <span className={styles.status} data-tone={ev.tone} role="status">
            <span className={styles.dot} aria-hidden="true" />
            {ev.status}
          </span>
        </div>
      )}
    </section>
  );
}
