/**
 * One item field (Input / Expected output / Metadata): stored-type tag,
 * read-only highlighted view, or a Text/JSON editor on drafts. The contract
 * (brief 07 §3): strings are never coerced; switching to JSON mode is the
 * only way a value changes type, and the tag shows `string → number`.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { textDirAttrs } from '@/lib/text';
import { CopyButton, IconButton, SegmentedControl, Tag, Text } from '@/ui';
import {
  defaultMode,
  editorTextToValue,
  formatJson,
  sameValue,
  storedType,
  valueToEditorText,
  type EditorMode,
  type StoredType,
} from '../lib/itemValue';
import styles from './FieldEditor.module.css';

export interface FieldState {
  mode: EditorMode;
  text: string;
}

export function initialFieldState(value: unknown, jsonOnly = false): FieldState {
  const mode: EditorMode = jsonOnly ? 'json' : defaultMode(value);
  return { mode, text: valueToEditorText(value, mode) };
}

export interface FieldStatus {
  ok: boolean;
  touched: boolean;
  value?: unknown;
  error?: string;
  fromType: StoredType;
  toType: StoredType | null;
}

/** Derive validity / touched / resulting type from editor state. */
export function fieldStatus(original: unknown, state: FieldState, jsonOnly = false): FieldStatus {
  const fromType = storedType(original);
  const parsed = editorTextToValue(state.text, state.mode);
  if (!parsed.ok) return { ok: false, touched: true, error: parsed.error, fromType, toType: null };
  if (jsonOnly && parsed.value !== null && (typeof parsed.value !== 'object' || Array.isArray(parsed.value)))
    return { ok: false, touched: true, error: 'Metadata must be a JSON object.', fromType, toType: null };
  const touched = !sameValue(parsed.value, original);
  return { ok: true, touched, value: parsed.value, fromType, toType: storedType(parsed.value) };
}

export interface FieldEditorProps {
  label: string;
  value: unknown;
  /** Draft: editable. */
  editable: boolean;
  /** Metadata: JSON object only, no Text mode. */
  jsonOnly?: boolean;
  state?: FieldState;
  onChange?: (state: FieldState) => void;
  compact?: boolean;
  actions?: ReactNode;
}

export function FieldEditor({ label, value, editable, jsonOnly, state, onChange, compact, actions }: FieldEditorProps) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const local = state ?? initialFieldState(value, jsonOnly);
  const status = useMemo(() => fieldStatus(value, local, jsonOnly), [value, local, jsonOnly]);
  const dir = useMemo(() => textDirAttrs(typeof value === 'string' ? value : local.text), [value, local.text]);
  const copyText = () => (typeof value === 'string' ? value : formatJson(value));

  const typeTag = (
    <Tag kind="data" data-testid="type-tag" tone={status.touched && status.toType && status.toType !== status.fromType ? 'warning' : undefined}>
      {status.touched && status.toType && status.toType !== status.fromType ? `${status.fromType} → ${status.toType}` : status.fromType}
    </Tag>
  );

  return (
    <section className={styles.panel} data-compact={compact ? '' : undefined} data-expanded={expanded ? '' : undefined} aria-labelledby={`${id}-label`}>
      <header className={styles.head}>
        <div className={styles.headLeft}>
          <span id={`${id}-label`} className={styles.label}>
            {label}
          </span>
          {typeTag}
        </div>
        <div className={styles.headActions}>
          {actions}
          <IconButton label={expanded ? `Collapse ${label}` : `Expand ${label}`} icon={expanded ? 'collapse' : 'expand'} onPress={() => setExpanded((e) => !e)} />
          <CopyButton text={copyText} label={`Copy ${label}`} />
        </div>
      </header>
      {editable ? (
        <>
          <div className={styles.editorWrap}>
            <textarea
              id={`${id}-input`}
              className={styles.textarea}
              aria-labelledby={`${id}-label`}
              aria-describedby={`${id}-status`}
              aria-invalid={!status.ok || undefined}
              value={local.text}
              spellCheck={false}
              rows={compact ? 4 : 8}
              {...dir}
              onChange={(e) => onChange?.({ ...local, text: e.target.value })}
            />
          </div>
          <footer className={styles.foot}>
            {!jsonOnly ? (
              <SegmentedControl<EditorMode>
                label={`${label} mode`}
                value={local.mode}
                options={[
                  { value: 'text', label: 'Text' },
                  { value: 'json', label: 'JSON' },
                ]}
                onChange={(mode) => {
                  if (mode === local.mode) return;
                  // Text → JSON keeps the typed text (so `42` becomes a number); JSON → Text keeps the text as-is.
                  onChange?.({ mode, text: local.text });
                }}
              />
            ) : (
              <span />
            )}
            <span id={`${id}-status`} className={styles.status} data-state={!status.ok ? 'error' : status.touched ? 'changed' : 'same'} aria-live="polite">
              <span className={styles.dot} aria-hidden="true" />
              {!status.ok
                ? `Not valid JSON${!jsonOnly ? '. Switch to Text to save it as a string.' : ''}${status.error ? ` (${status.error})` : ''}`
                : status.touched
                  ? status.toType !== status.fromType
                    ? `will be saved as ${status.toType}`
                    : 'changed'
                  : 'unchanged'}
            </span>
          </footer>
        </>
      ) : (
        <ReadOnlyValue value={value} dir={dir} compact={compact} />
      )}
    </section>
  );
}

export function ReadOnlyValue({ value, dir, compact }: { value: unknown; dir?: ReturnType<typeof textDirAttrs>; compact?: boolean }) {
  if (typeof value === 'string') {
    return (
      <pre className={styles.pre} data-compact={compact ? '' : undefined} {...(dir ?? textDirAttrs(value))}>
        {value || <Text as="span" variant="sm" tone="muted">(empty)</Text>}
      </pre>
    );
  }
  return (
    <pre className={styles.pre} data-compact={compact ? '' : undefined} dir="ltr">
      <JsonHighlight text={formatJson(value)} />
    </pre>
  );
}

const TOKEN_SOURCE = String.raw`("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`;

/** Token-coloured JSON (keys, strings, numbers, literals) without innerHTML. */
export function JsonHighlight({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    const token = new RegExp(TOKEN_SOURCE, 'g');
    while ((m = token.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] !== undefined) {
        out.push(
          <span key={i++} className={m[2] ? styles.tokKey : styles.tokStr}>
            {m[1]}
          </span>,
        );
        if (m[2]) out.push(m[2]);
      } else if (m[3] !== undefined) out.push(<span key={i++} className={styles.tokLit}>{m[3]}</span>);
      else if (m[4] !== undefined) out.push(<span key={i++} className={styles.tokNum}>{m[4]}</span>);
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text]);
  return <>{parts}</>;
}
