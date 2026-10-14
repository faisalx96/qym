/** "All <entries>" / "All roles": one value written to every target pointer (setAllInput). */
import { memo, useState } from 'react';
import {
  enumOptions,
  formatDefault,
  formatInput,
  parseInput,
  isSweepable,
  setAllInput,
  setGlobalSweep,
  sharedSweep,
  startGlobalSweep,
  stopGlobalSweep,
  type AllItemsField,
  type DescriptorEntry,
} from '../model';
import { Button, Popover } from '@/ui';
import { plural } from '../../lib/format';
import { useLaunch } from '../LaunchContext';
import { endpointNames, useSettingsActions } from './SettingsContext';
import { SweepChips } from './SweepChips';
import { withPrunedLinks } from './sweepDoc';
import styles from './settings.module.css';

const MIXED = '__mixed__';

function unsetLabel(entry: DescriptorEntry): string {
  return entry.has_default ? `Default (${formatDefault(entry.default)})` : 'Inherit';
}

export interface AllItemsControlProps {
  field: AllItemsField;
  /** Narrower targets than `field.pointers` (rows a role search hides are skipped). */
  pointers?: readonly string[];
  /** Overrides `field.same` / `field.value` when the targets were narrowed. */
  same?: boolean;
  value?: AllItemsField['value'];
}

function AllItemsControlImpl(props: AllItemsControlProps) {
  const { field, pointers } = props;
  const { setDoc, endpoints, sweeps, ctx } = useSettingsActions();
  const { doc } = useLaunch();
  const targets = pointers ?? field.pointers;
  const swept = sharedSweep(doc, targets);
  if (swept) {
    const summary = swept.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' · ');
    return (
      <div className={styles.globalSweep} data-global-sweep="">
        <Popover
          label={`Sweep values of ${field.label}`}
          placement="bottom start"
          trigger={
            <Button
              size="sm"
              variant="neutral"
              aria-label={`Edit sweep: ${field.label}`}
              className={styles.sweepTrigger}
            >
              <span className={styles.sweepSummary} title={summary || 'No values yet'}>
                {summary || 'Add values'}
              </span>
            </Button>
          }
        >
          <div className={styles.sweepPopover}>
            <SweepChips
              entry={field.entry}
              label={field.label}
              values={swept}
              endpointKeys={endpointNames({ endpoints }, field.entry)}
              onChange={(values) => setDoc((d) => setGlobalSweep(d, targets, values))}
              onSingle={() => setDoc((d) => withPrunedLinks(stopGlobalSweep(d, targets), ctx))}
            />
          </div>
        </Popover>
        <span className={styles.hint}>
          {swept.length ? `sweeps ${plural(swept.length, 'run')}` : 'add values to sweep'}
        </span>
      </div>
    );
  }
  const shared =
    props.same !== undefined ? (props.same ? props.value : undefined) : field.same ? field.value : undefined;
  const canSweep = sweeps && isSweepable(field.entry) && targets.length > 0;
  return (
    <>
      <PlainAllControl {...props} />
      {canSweep ? (
        <button
          type="button"
          className={styles.linkBtn}
          aria-label={`Sweep values: ${field.label}`}
          title="One run per value, for every item together"
          onClick={() => setDoc((d) => startGlobalSweep(d, field.entry, targets, shared))}
        >
          Sweep values
        </button>
      ) : null}
    </>
  );
}

function PlainAllControl({ field, pointers, same, value }: AllItemsControlProps) {
  const { setDoc, endpoints } = useSettingsActions();
  const { entry, label } = field;
  const targets = pointers ?? field.pointers;
  const isSame = same ?? field.same;
  const current = same !== undefined ? value : field.value;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState('');

  const apply = (raw: string) => {
    const parsed = parseInput(entry, raw);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    setError('');
    setDraft(null);
    setDoc((d) => setAllInput(d, entry, targets, raw).doc);
  };

  const isSelect = entry.type === 'boolean' || entry.type === 'enum' || entry.widget === 'endpoint-ref';
  if (isSelect) {
    const shown = isSame ? formatInput(entry, current) : MIXED;
    const keys = entry.widget === 'endpoint-ref' ? endpointNames({ endpoints }, entry) : [];
    return (
      <select
        className={styles.control}
        data-mono={entry.widget === 'endpoint-ref' ? '' : undefined}
        aria-label={label}
        title="A value set here is written to every item"
        disabled={!targets.length}
        value={shown}
        onChange={(e) => {
          if (e.target.value !== MIXED) apply(e.target.value);
        }}
      >
        {!isSame ? <option value={MIXED}>Mixed</option> : null}
        <option value="">{unsetLabel(entry)}</option>
        {entry.type === 'boolean' ? (
          <>
            <option value="true">true</option>
            <option value="false">false</option>
          </>
        ) : entry.type === 'enum' ? (
          enumOptions(entry).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        ) : (
          keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))
        )}
      </select>
    );
  }
  const shown = isSame ? formatInput(entry, current) : '';
  const numeric = entry.type === 'integer' || entry.type === 'number';
  return (
    <>
      <input
        className={styles.control}
        data-mono={numeric || entry.widget === 'model-name' || entry.widget === 'url' ? '' : undefined}
        type="text"
        spellCheck={false}
        inputMode={numeric ? 'decimal' : undefined}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={error || 'A value set here is written to every item'}
        placeholder={isSame ? undefined : 'Mixed'}
        disabled={!targets.length}
        value={draft ?? shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== shown) apply(draft);
          else setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply(draft ?? shown);
          }
        }}
      />
      {error ? (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      ) : null}
    </>
  );
}

export const AllItemsControl = memo(
  AllItemsControlImpl,
  (a, b) =>
    a.field.entry === b.field.entry &&
    a.field.label === b.field.label &&
    a.field.same === b.field.same &&
    a.same === b.same &&
    a.field.pointers.join('|') === b.field.pointers.join('|') &&
    (a.pointers ?? []).join('|') === (b.pointers ?? []).join('|') &&
    JSON.stringify(a.field.value) === JSON.stringify(b.field.value) &&
    JSON.stringify(a.value) === JSON.stringify(b.value),
);
