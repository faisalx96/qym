/**
 * One setting: label row (changed dot, tags, sweep / reset actions), the control for its kind, hint
 * and error text. Memoized on the node's own data (the tree is rebuilt on every edit), and typing is
 * kept in local state: the value reaches the document on pick, on blur / Enter and shortly after
 * the last keystroke, so one keystroke does not re-render the other fields.
 */
import { memo, useEffect, useId, useRef, useState } from 'react';
import { IconButton, Tag } from '@/ui';
import {
  enumOptions,
  envName,
  formatDefault,
  formatInput,
  isSweepable,
  isSweepValue,
  resetField,
  setLeafInput,
  setValue,
  startSweep,
  dropValuesUnder,
  removeKey,
  unescapeSegment,
  splitPointer,
  type DescriptorEntry,
  type JsonValue,
  type LeafNode,
} from '../model';
import { containerOf, JsonFields } from './JsonFields';
import { endpointNames, useSettingsActions } from './SettingsContext';
import { leafEqual } from './leafEqual';
import { SweepChips } from './SweepChips';
import { singleAxis, withPrunedLinks } from './sweepDoc';
import styles from './settings.module.css';

const DEBOUNCE_MS = 300;

export interface LeafFieldProps {
  node: LeafNode;
  /** Server / validation messages for this field, joined with newlines. */
  error: string;
  /** `cell`: a role-table cell (no visible label, compact actions). */
  variant?: 'field' | 'cell';
  /** Extra-key list this leaf can be removed from (`<object>#extra`); '' removes an "Other values" entry. */
  removeList?: string | null;
}

/** JSON encoding of a leaf for the structured editor: 'json', 'string' (JSON text in a text field) or null. */
function jsonEncoding(entry: DescriptorEntry): 'json' | 'string' | null {
  if (entry.secret || entry.widget === 'secret') return null;
  if (entry.type === 'json' || entry.type === 'array' || entry.type === 'object') return 'json';
  return entry.type === 'string' && entry.widget === 'text' ? 'string' : null;
}

function unsetLabel(entry: DescriptorEntry, bound: string | null, placeholder: string): string {
  if (bound) return placeholder;
  return entry.has_default ? `Default (${formatDefault(entry.default)})` : 'Inherit';
}

/** Local text of an input: committed on blur / Enter, and shortly after the last keystroke. */
function useDraft(external: string, commit: (text: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current !== null) {
      const text = pending.current;
      pending.current = null;
      commitRef.current(text);
    }
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null) commitRef.current(pending.current);
    },
    [],
  );
  return {
    value: draft ?? external,
    onChange: (text: string) => {
      setDraft(text);
      pending.current = text;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    onBlur: () => {
      flush();
      setDraft(null);
    },
    flush,
  };
}

function LeafFieldImpl({ node, error, variant = 'field', removeList = null }: LeafFieldProps) {
  const id = useId();
  const actions = useSettingsActions();
  const { ctx, setDoc, registerField, sweeps } = actions;
  const [rawMode, setRawMode] = useState(false);
  const { entry, edit, kind } = node;
  const bound = node.boundBy;
  const cell = variant === 'cell';
  const asJson = edit.fallback !== undefined;
  const messages = Array.from(
    new Set(
      [node.invalid?.message, ...error.split('\n'), ...node.notInEnvErrors].filter((m): m is string =>
        Boolean(m),
      ),
    ),
  );
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const hint = cell ? '' : node.hint;
  const describedBy =
    [hint ? hintId : '', messages.length ? errId : ''].filter(Boolean).join(' ') || undefined;
  const mono = kind === 'number' || entry.widget === 'model-name' || entry.widget === 'url';

  const external = formatInput(edit, node.value, node.invalid?.raw);
  const commitText = (text: string) => setDoc((d) => setLeafInput(d, entry, node.pointer, text, asJson));
  const draft = useDraft(external, commitText);

  const ref = (el: HTMLElement | null) => registerField(node.fieldName, el);
  const controlProps = {
    id,
    className: styles.control,
    disabled: Boolean(bound),
    'aria-label': cell ? node.label : undefined,
    'aria-invalid': messages.length ? true : undefined,
    'aria-describedby': describedBy,
    title: bound ? `Filled by the ${bound} model` : undefined,
  };

  const encoding = jsonEncoding(entry);
  const structuredOk = Boolean(encoding) && !bound && !asJson && !node.invalid && !rawMode;
  const container = structuredOk && encoding ? containerOf(node.value, encoding) : null;
  const startValue = (): JsonValue | undefined => {
    if (!encoding) return undefined;
    if (node.value !== undefined) return containerOf(node.value, encoding) ? node.value : undefined;
    if (entry.has_default && containerOf(entry.default, encoding)) return entry.default;
    return encoding === 'json' ? (entry.type === 'array' ? [] : {}) : undefined;
  };
  const canEditAsFields = Boolean(encoding) && !bound && !asJson && startValue() !== undefined;

  let control: JSX.Element;
  if (node.swept && isSweepValue(node.value) && !bound) {
    const swept = node.value.sweep;
    control = (
      <SweepChips
        entry={entry}
        label={node.label}
        values={swept}
        endpointKeys={endpointNames(actions, entry)}
        fieldRef={ref}
        onChange={(values) => setDoc((d) => setValue(d, node.pointer, { sweep: values }))}
        onSingle={() =>
          setDoc((d) =>
            withPrunedLinks(
              singleAxis(d, { kind: 'setting', pointer: node.pointer }, d.values[node.pointer]),
              ctx,
            ),
          )
        }
      />
    );
  } else if (node.swept) {
    control = (
      <input
        {...controlProps}
        ref={ref}
        data-mono=""
        type="text"
        readOnly
        value={
          isSweepValue(node.value)
            ? `Sweep: ${node.value.sweep.map((v) => JSON.stringify(v)).join(', ')}`
            : ''
        }
      />
    );
  } else if (kind === 'secret') {
    control = (
      <input
        {...controlProps}
        ref={ref}
        type="text"
        disabled
        value=""
        readOnly
        placeholder={bound ? node.placeholder : 'Keys are set through model slots'}
      />
    );
  } else if (container && encoding) {
    control = (
      <JsonFields
        value={container}
        label={node.label}
        fieldRef={ref}
        onRaw={() => setRawMode(true)}
        onEdit={(fn) =>
          setDoc((d) => {
            const current = containerOf(d.values[node.pointer], encoding);
            if (!current) return d;
            const next = fn(JSON.parse(JSON.stringify(current)) as JsonValue);
            return setValue(d, node.pointer, encoding === 'string' ? JSON.stringify(next) : next);
          })
        }
      />
    );
  } else if (kind === 'boolean' || kind === 'enum' || kind === 'endpoint-ref') {
    let options: Array<{ value: string; label: string }>;
    if (kind === 'boolean')
      options = [
        { value: 'true', label: 'true' },
        { value: 'false', label: 'false' },
      ];
    else if (kind === 'enum') options = enumOptions(entry).map((o) => ({ value: o.value, label: o.label }));
    else {
      const keys = endpointNames(actions, entry).slice();
      if (typeof node.value === 'string' && node.value && !keys.includes(node.value)) keys.push(node.value);
      options = keys.map((k) => ({ value: k, label: k }));
    }
    control = (
      <select
        {...controlProps}
        ref={ref}
        data-mono={kind === 'endpoint-ref' ? '' : undefined}
        value={external}
        onChange={(e) => commitText(e.target.value)}
      >
        <option value="">
          {kind === 'endpoint-ref' ? 'Inherit' : unsetLabel(entry, bound, node.placeholder)}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (kind === 'json' || kind === 'array' || kind === 'object') {
    control = (
      <textarea
        {...controlProps}
        ref={ref}
        spellCheck={false}
        rows={cell ? 2 : 4}
        placeholder={node.placeholder}
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
        onBlur={draft.onBlur}
      />
    );
  } else {
    control = (
      <input
        {...controlProps}
        ref={ref}
        data-mono={mono ? '' : undefined}
        type="text"
        spellCheck={false}
        inputMode={kind === 'number' ? 'decimal' : undefined}
        placeholder={node.placeholder}
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
        onBlur={draft.onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Enter') draft.flush();
        }}
      />
    );
  }

  const sweepable =
    sweeps &&
    !bound &&
    !node.swept &&
    !asJson &&
    kind !== 'secret' &&
    isSweepable(entry) &&
    node.value !== null;
  const canRemove = node.removable && removeList !== null;
  const reset = node.changed ? (
    cell ? (
      <IconButton
        label={`Reset ${node.label}`}
        icon="retry"
        onPress={() => setDoc((d) => resetField(d, node.pointer))}
      />
    ) : (
      <button
        type="button"
        className={styles.linkBtn}
        aria-label={`Reset ${node.label}`}
        onClick={() => setDoc((d) => resetField(d, node.pointer))}
      >
        Reset
      </button>
    )
  ) : null;
  const sweepBtn = sweepable ? (
    cell ? (
      <IconButton
        label={`Sweep values: ${node.label}`}
        icon="plus"
        onPress={() => setDoc((d) => setValue(d, node.pointer, startSweep(entry, d.values[node.pointer])))}
      />
    ) : (
      <button
        type="button"
        className={styles.linkBtn}
        aria-label={`Sweep values: ${node.label}`}
        title="Run the experiment once per value"
        onClick={() => setDoc((d) => setValue(d, node.pointer, startSweep(entry, d.values[node.pointer])))}
      >
        Sweep values
      </button>
    )
  ) : null;
  const removeBtn = canRemove ? (
    <button
      type="button"
      className={styles.linkBtn}
      aria-label={`Remove ${node.label}`}
      onClick={() =>
        setDoc((d) => {
          const key = unescapeSegment(splitPointer(node.pointer).slice(-1)[0] ?? '');
          if (removeList) return removeKey(d, removeList, node.pointer, key);
          return dropValuesUnder(d, node.pointer);
        })
      }
    >
      Remove
    </button>
  ) : null;
  const editAsFields =
    !container &&
    canEditAsFields &&
    (rawMode || kind === 'json' || kind === 'array' || kind === 'object' || kind === 'text') ? (
      <button
        type="button"
        className={styles.linkBtn}
        aria-label={`Edit ${node.label} as fields`}
        onClick={() => {
          setRawMode(false);
          const start = startValue();
          if (start !== undefined && node.value !== start) setDoc((d) => setValue(d, node.pointer, start));
        }}
      >
        Edit as fields
      </button>
    ) : null;

  const dot = node.changed ? (
    <>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.sr}>changed</span>
    </>
  ) : null;
  const tags = (
    <>
      {bound ? <Tag kind="data">{`Set by ${bound}`}</Tag> : null}
      {node.missingEnvs.map((e) => (
        <Tag key={e} tone="warning">{`not in ${envName(ctx, e)}`}</Tag>
      ))}
    </>
  );
  const errorsEl = messages.length ? (
    <div id={errId}>
      {messages.map((m) => (
        <p key={m} className={styles.error}>
          {m}
        </p>
      ))}
    </div>
  ) : null;

  if (cell) {
    return (
      <div className={styles.cell} data-field={node.fieldName} data-changed={node.changed ? '' : undefined}>
        <div className={styles.cellRow}>
          {control}
          {dot}
          {reset}
          {sweepBtn}
        </div>
        {node.missingEnvs.length ? tags : null}
        {errorsEl}
      </div>
    );
  }
  const labelEl =
    node.swept || container ? (
      <span className={styles.label}>{node.title}</span>
    ) : (
      <label className={styles.label} htmlFor={id}>
        {node.title}
      </label>
    );
  return (
    <div className={styles.field} data-field={node.fieldName} data-changed={node.changed ? '' : undefined}>
      <div className={styles.fieldHead}>
        <span className={styles.headMain}>
          {labelEl}
          {node.entry.name && node.entry.name !== node.title ? (
            <span className={styles.keyName} title="Setting key">
              {node.entry.name}
            </span>
          ) : null}
          {dot}
          {tags}
        </span>
        <span className={styles.headActions}>
          {editAsFields}
          {reset}
          {sweepBtn}
          {removeBtn}
        </span>
      </div>
      {control}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {errorsEl}
    </div>
  );
}

export const LeafField = memo(
  LeafFieldImpl,
  (a, b) =>
    leafEqual(a.node, b.node) &&
    a.error === b.error &&
    a.variant === b.variant &&
    a.removeList === b.removeList,
);
