import { useState } from 'react';
import { Button, Select, Tag, TextField, Textarea } from '@/ui';
import { useLaunch } from '../LaunchContext';
import {
  enumOptions,
  formatInput,
  hintText,
  isSweepValue,
  leafKind,
  placeholderFor,
  pointerToFieldName,
  setConfig,
  setConfigInput,
  stopSweep,
  type EvaluatorFieldView,
} from '../model';
import styles from './evaluation.module.css';

const UNSET = '__unset__';

/** Text that stays what the user typed while they type ("1." must not collapse to "1"). */
function useDraft(text: string) {
  const [draft, setDraft] = useState<string | null>(null);
  return { shown: draft ?? text, set: (v: string) => setDraft(v), clear: () => setDraft(null) };
}

/**
 * One generated control of the evaluation inputs: the same widgets as the settings leaves (select
 * for booleans and enums, a text field for numbers and strings, JSON for the rest), writing to
 * `evaluator.config` on top of the base's own value.
 */
export function FieldControl({ field }: { field: EvaluatorFieldView }) {
  const { ctx, setDoc, registerField } = useLaunch();
  const { name, entry, editEntry: edit } = field;
  const kind = leafKind(edit);
  const asJson = edit.fallback !== undefined;
  const text = formatInput(edit, field.value, field.invalid?.raw);
  const draft = useDraft(text);
  const swept = isSweepValue(field.value);
  const label = entry.label || name;
  const hint = hintText(edit);
  const missing = field.missingEnvs.map((id) => ctx.envs.find((e) => e.id === id)?.name ?? id);
  const error = field.invalid?.message;
  const locked = field.locked;
  const commit = (raw: string) => setDoc((d) => setConfigInput(d, entry, name, raw, asJson));
  const placeholder =
    field.baseValue !== undefined
      ? `Starting point: ${typeof field.baseValue === 'string' ? field.baseValue : JSON.stringify(field.baseValue)}`
      : placeholderFor(edit);
  const help = [locked ? 'Set by the Dataset section (an alias is picked).' : '', hint]
    .filter(Boolean)
    .join(' ');
  const fieldName = pointerToFieldName('/evaluator/config/' + name);

  let control;
  if (swept) {
    control = (
      <div className={styles.readonlyRow}>
        <Tag kind="data">swept</Tag>
        <span className={styles.mono}>
          {(field.value as { sweep: unknown[] }).sweep.map((v) => JSON.stringify(v)).join(', ')}
        </span>
        <Button variant="ghost" onPress={() => setDoc((d) => setConfig(d, name, stopSweep(field.value)))}>
          Single value
        </Button>
      </div>
    );
  } else if (kind === 'boolean' || kind === 'enum') {
    const items =
      kind === 'boolean'
        ? [
            { key: UNSET, label: 'Inherit' },
            { key: 'true', label: 'true' },
            { key: 'false', label: 'false' },
          ]
        : [
            { key: UNSET, label: 'Inherit' },
            ...enumOptions(edit).map((o) => ({ key: o.value, label: o.label })),
          ];
    control = (
      <Select
        label={label}
        hideLabel
        items={items}
        value={text === '' ? UNSET : text}
        isDisabled={locked}
        onChange={(k) => commit(k == null || k === UNSET ? '' : String(k))}
        errorMessage={error}
      />
    );
  } else if (kind === 'json' || kind === 'array' || kind === 'object') {
    control = (
      <Textarea
        label={label}
        hideLabel
        mono
        rows={3}
        dir="ltr"
        value={draft.shown}
        isDisabled={locked}
        placeholder={placeholder}
        onChange={(v) => {
          draft.set(v);
          commit(v);
        }}
        onBlur={draft.clear}
        errorMessage={error}
      />
    );
  } else {
    control = (
      <TextField
        label={label}
        hideLabel
        mono={kind === 'number'}
        value={draft.shown}
        isDisabled={locked}
        placeholder={placeholder}
        onChange={(v) => {
          draft.set(v);
          commit(v);
        }}
        onBlur={draft.clear}
        errorMessage={error}
      />
    );
  }

  return (
    <div
      className={[
        styles.field,
        kind === 'json' || kind === 'array' || kind === 'object' ? styles.fieldWide : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-eval-field={name}
      ref={(el) => registerField(fieldName, el)}
    >
      <div className={styles.fieldHead}>
        {field.changed ? (
          <span className={styles.dot} data-changed>
            <span className={styles.sr}>Changed from the starting point</span>
          </span>
        ) : null}
        <span>{label}</span>
        <Tag kind="data">{name}</Tag>
        {missing.map((n) => (
          <Tag key={n} tone="warning">
            not in {n}
          </Tag>
        ))}
        <span className={styles.spacer} />
        {field.changed ? (
          <Button
            variant="ghost"
            aria-label={`Reset ${label} to the starting point`}
            onPress={() => {
              draft.clear();
              setDoc((d) => setConfig(d, name, field.baseValue));
            }}
          >
            Reset
          </Button>
        ) : null}
      </div>
      {control}
      {help ? <p className={styles.hint}>{help}</p> : null}
    </div>
  );
}
