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
import { Button, IconButton, Popover, Select, TextField } from '@/ui';
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
            <Button size="sm" variant="neutral" className={styles.sweepTrigger}>
              <span className={styles.sweepSummary} title={summary || 'No values yet'}>
                {summary || 'Add values'}
              </span>
              <span className={styles.sr}>{`, edit sweep: ${field.label}`}</span>
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
        <IconButton
          label={`Sweep values: ${field.label}`}
          icon="plus"
          onPress={() => setDoc((d) => startGlobalSweep(d, field.entry, targets, shared))}
        />
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
    const options =
      entry.type === 'boolean'
        ? ['true', 'false'].map((v) => ({ key: v, label: v }))
        : entry.type === 'enum'
          ? enumOptions(entry).map((o) => ({ key: o.value, label: o.label }))
          : keys.map((k) => ({ key: k, label: k }));
    return (
      <span title="A value set here is written to every item">
        <Select
          label={label}
          hideLabel
          items={[
            ...(!isSame ? [{ key: MIXED, label: 'Mixed' }] : []),
            { key: '', label: unsetLabel(entry) },
            ...options,
          ]}
          value={shown}
          onChange={(k) => {
            const v = String(k ?? '');
            if (v !== MIXED) apply(v);
          }}
          isDisabled={!targets.length}
        />
      </span>
    );
  }
  const shown = isSame ? formatInput(entry, current) : '';
  const numeric = entry.type === 'integer' || entry.type === 'number';
  return (
    <>
      <TextField
        label={label}
        hideLabel
        mono={numeric || entry.widget === 'model-name' || entry.widget === 'url'}
        spellCheck="false"
        inputMode={numeric ? 'decimal' : undefined}
        isInvalid={Boolean(error)}
        title={error || 'A value set here is written to every item'}
        placeholder={isSame ? undefined : 'Mixed'}
        isDisabled={!targets.length}
        value={draft ?? shown}
        onChange={setDraft}
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
