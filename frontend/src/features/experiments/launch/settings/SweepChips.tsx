/**
 * The chip editor of a swept value (`{sweep: [...]}`): option chips for booleans, enums and endpoint
 * names, typed chips (with a range helper) for numbers and text. Used by swept settings and by the
 * axes of the Sweeps section.
 */
import { useId, useState } from 'react';
import { Button, Icon } from '@/ui';
import { plural } from '../../lib/format';
import {
  addSweepValues,
  choiceOptions,
  expandRange,
  formatSweepValue,
  parseTypedList,
  removeSweepValue,
  SWEEP_EMPTY_MESSAGE,
  toggleChoice,
  sameValue,
  type DescriptorEntry,
  type JsonValue,
} from '../model';
import styles from './settings.module.css';

export interface SweepChipsProps {
  entry: DescriptorEntry;
  label: string;
  values: readonly JsonValue[];
  endpointKeys?: readonly string[];
  onChange: (values: JsonValue[]) => void;
  /** "Single value": stop sweeping, keep the first value. */
  onSingle: () => void;
  /** Registered for problem clicks (the group wrapper is focusable). */
  fieldRef?: (el: HTMLElement | null) => void;
}

export function SweepChips({
  entry,
  label,
  values,
  endpointKeys = [],
  onChange,
  onSingle,
  fieldRef,
}: SweepChipsProps) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [range, setRange] = useState<{ open: boolean; start: string; stop: string; step: string }>({
    open: false,
    start: '',
    stop: '',
    step: '',
  });
  const [message, setMessage] = useState('');
  const options = choiceOptions(entry, endpointKeys);
  const numeric = entry.type === 'integer' || entry.type === 'number';

  const add = (list: readonly JsonValue[]) => {
    const { values: next, skipped } = addSweepValues(values, list);
    setMessage(skipped ? `${plural(skipped, 'duplicate value')} skipped` : '');
    onChange(next);
  };
  const addTyped = () => {
    const parsed = parseTypedList(entry, typed);
    if ('error' in parsed) {
      setMessage(parsed.error);
      return;
    }
    if (!parsed.values.length) return;
    add(parsed.values);
    setTyped('');
  };
  const addRange = () => {
    const result = expandRange(entry, range.start, range.stop, range.step);
    if ('error' in result) {
      setMessage(result.error);
      return;
    }
    setRange({ open: false, start: '', stop: '', step: '' });
    add(result.values);
  };

  const extras = options ? values.filter((v) => !options.some((o) => sameValue(o.value, v))) : values;
  const valueChip = (v: JsonValue, i: number) => (
    <li key={`${i}:${JSON.stringify(v)}`} className={styles.chip}>
      <span>{formatSweepValue(v)}</span>
      <button
        type="button"
        className={styles.chipRemove}
        aria-label={`Remove ${formatSweepValue(v)} from ${label}`}
        onClick={() => {
          setMessage('');
          onChange(removeSweepValue(values, v));
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </li>
  );

  return (
    <div
      ref={fieldRef}
      className={styles.sweep}
      role="group"
      aria-label={`${label} (swept values)`}
      tabIndex={-1}
      data-sweep=""
    >
      {options ? (
        <div role="group" aria-label={`${label} values`} className={styles.chips}>
          {options.map((o) => {
            const pressed = values.some((v) => sameValue(v, o.value));
            return (
              <button
                key={o.text}
                type="button"
                className={styles.chip}
                aria-pressed={pressed}
                onClick={() => {
                  setMessage('');
                  onChange(toggleChoice(options, values, o.value));
                }}
              >
                {o.text}
              </button>
            );
          })}
          {extras.length ? (
            <ul className={styles.chips} aria-label={`Other ${label} values`}>
              {extras.map(valueChip)}
            </ul>
          ) : null}
        </div>
      ) : (
        <>
          {values.length ? (
            <ul className={styles.chips} aria-label={`${label} values`}>
              {values.map(valueChip)}
            </ul>
          ) : (
            <p className={styles.hint}>No values yet</p>
          )}
          <div className={styles.sweepRow}>
            <input
              className={[styles.control, styles.sweepInput].join(' ')}
              data-mono={numeric ? '' : undefined}
              type="text"
              spellCheck={false}
              inputMode={numeric ? 'decimal' : undefined}
              placeholder={numeric ? 'Add values: 0.5, 0.7' : 'Add a value'}
              aria-label={`Add values to ${label}`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTyped();
                }
              }}
            />
            <Button size="sm" onPress={addTyped} aria-label={`Add typed values to ${label}`}>
              Add
            </Button>
            {numeric ? (
              <button
                type="button"
                className={styles.linkBtn}
                aria-expanded={range.open}
                aria-controls={`${id}-range`}
                onClick={() => {
                  setMessage('');
                  setRange((r) => ({ ...r, open: !r.open }));
                }}
              >
                {range.open ? 'Hide range' : 'Range…'}
              </button>
            ) : null}
          </div>
          {numeric && range.open ? (
            <div id={`${id}-range`} className={styles.sweepRow}>
              {(['start', 'stop', 'step'] as const).map((k) => (
                <input
                  key={k}
                  className={[styles.control, styles.rangeInput].join(' ')}
                  data-mono=""
                  type="text"
                  inputMode="decimal"
                  spellCheck={false}
                  placeholder={k[0]?.toUpperCase() + k.slice(1)}
                  aria-label={`${k[0]?.toUpperCase() + k.slice(1)} of the range for ${label}`}
                  value={range[k]}
                  onChange={(e) => setRange((r) => ({ ...r, [k]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addRange();
                    }
                  }}
                />
              ))}
              <Button size="sm" onPress={addRange} aria-label={`Add range to ${label}`}>
                Add range
              </Button>
            </div>
          ) : null}
        </>
      )}
      <div className={styles.sweepRow}>
        <span className={styles.hint} data-mono="">
          {plural(values.length, 'value')}
        </span>
        {message ? (
          <span role="status" className={styles.hint}>
            {message}
          </span>
        ) : null}
        <span className={styles.spacer} />
        <button
          type="button"
          className={styles.linkBtn}
          title="Stop sweeping: keep the first value"
          aria-label={`Single value for ${label}`}
          onClick={onSingle}
        >
          Single value
        </button>
      </div>
      {!values.length ? (
        <p role="alert" className={styles.error}>
          {SWEEP_EMPTY_MESSAGE}.
        </p>
      ) : null}
    </div>
  );
}
