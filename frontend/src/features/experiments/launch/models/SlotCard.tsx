import { useState } from 'react';
import { TemporaryModelForm } from '@/features/environments/TemporaryModelForm';
import { Button, SegmentedControl, Select, Tag, Card } from '@/ui';
import { useLaunch } from '../LaunchContext';
import {
  bindingChanged,
  bindingFromSweepItem,
  canEnterKeys,
  deepCopy,
  endpointName,
  followsGlobal,
  pointerToFieldName,
  removeExtraEndpoint,
  resetSlot,
  ROLE_LABELS,
  setBinding,
  slotConnections,
  slotPointer,
  startModelSweep,
  type SlotBinding,
  type SweepModelItem,
  type UnionSlot,
} from '../model';
import { withPrunedLinks } from '../settings/sweepDoc';
import { bindingFromTemporaryForm, connectionLabel } from './keys';
import { ReenterKeyRow } from './ReenterKeyRow';
import { SweepChips } from './SweepChips';
import { TemporaryChip } from './TemporaryChip';
import styles from './models.module.css';

const INHERIT = '__inherit__';
type Mode = 'global' | 'custom' | 'temporary';

/** One model card per confirmed slot: where its model comes from, and the model itself. */
export function SlotCard({ slot }: { slot: UnionSlot }) {
  const { doc, ctx, setDoc, secrets, review, registerField, canManage, mode: formMode } = useLaunch();
  const [formOpen, setFormOpen] = useState(false);
  const key = slot.slot_key;
  const binding = doc.bindings[key];
  const changed = bindingChanged(doc, key);
  const isEndpoint = slot.kind === 'endpoint';
  const follows = isEndpoint && followsGlobal(doc, key);
  const g = doc.globalModel;
  const keys = canEnterKeys(ctx);
  const connections = slotConnections(ctx, slot);
  const missing = ctx.envs.filter((e) => e.form && !slot.envs.includes(e.id));
  const problems = review.items.filter(
    (i) => i.pointer === slotPointer(key) || i.pointer.startsWith(slotPointer(key) + '/'),
  );
  const fills = Object.keys(slot.field_map).map((r) => ROLE_LABELS[r] ?? r);
  const sets = slot.extra_field_maps.length + 1;
  const launchMode = formMode === 'launch';

  const mode: Mode = formOpen
    ? 'temporary'
    : follows
      ? 'global'
      : binding?.kind === 'temporary'
        ? 'temporary'
        : 'custom';

  const bind = (next: SlotBinding | null) => {
    setFormOpen(false);
    setDoc((d) => withPrunedLinks(setBinding(d, ctx, key, next, secrets), ctx));
  };

  function chooseMode(next: Mode) {
    if (next === mode) return;
    if (next === 'global') {
      if (g) bind(deepCopy(g));
    } else if (next === 'custom') {
      bind(null);
    } else {
      setFormOpen(true);
    }
  }

  const selectItems: Array<{ key: string; label: string; description?: string; disabled?: boolean }> = [
    { key: INHERIT, label: 'Inherit (the worker’s own setting)' },
    ...connections.map((c) => ({
      key: c.id,
      label: connectionLabel(c),
      description: c.available ? undefined : c.reasons.join('; '),
      disabled: !c.available && !(binding?.kind === 'connection' && binding.id === c.id),
    })),
  ];
  if (binding?.kind === 'connection' && !connections.some((c) => c.id === binding.id))
    selectItems.push({ key: binding.id, label: `${binding.id} (not available)` });

  const sweep = binding?.kind === 'sweep' ? binding : null;
  const name = endpointName(key);

  return (
    <Card as="article" data-model-card={key} aria-label={slot.label}>
      <div className={styles.cardStack}>
        <div className={styles.head}>
          {changed ? (
            <span className={styles.dot} data-binding-changed>
              <span className={styles.sr}>Changed from the starting point</span>
            </span>
          ) : null}
          <span className={styles.title}>{slot.label}</span>
          <Tag kind="data">{key}</Tag>
          {slot.required ? <Tag kind="role">required</Tag> : null}
          {slot.extra ? <Tag kind="accent">this experiment</Tag> : null}
          {g && isEndpoint ? (
            follows ? (
              <Tag kind="accent" data-global-state="follows">
                follows global
              </Tag>
            ) : (
              <Tag tone="warning" data-global-state="custom">
                custom
              </Tag>
            )
          ) : null}
          {missing.map((e) => (
            <Tag key={e.id} tone="warning">
              not in {e.name}
            </Tag>
          ))}
          <span className={styles.spacer} />
          {slot.extra && name ? (
            <Button
              variant="ghost"
              aria-label={`Remove ${slot.label}`}
              onPress={() => setDoc((d) => removeExtraEndpoint(d, name, secrets))}
            >
              Remove
            </Button>
          ) : null}
          {changed ? (
            <Button
              variant="ghost"
              aria-label={`Reset ${slot.label} to the starting model`}
              onPress={() => {
                setFormOpen(false);
                setDoc((d) => resetSlot(d, ctx, key, secrets));
              }}
            >
              Reset
            </Button>
          ) : null}
        </div>
        <p className={styles.hint}>
          Fills {fills.join(', ') || 'no fields'}
          {sets > 1 ? ` in ${sets} key sets` : ''}.
        </p>

        <div className={styles.stack} ref={(el) => registerField(pointerToFieldName(slotPointer(key)), el)}>
          {sweep ? (
            <SweepChips
              label={slot.label}
              items={sweep.items}
              connections={connections}
              onChange={(items: SweepModelItem[]) => bind({ kind: 'sweep', items })}
              onSingle={() => bind(bindingFromSweepItem(sweep.items[0]))}
            />
          ) : (
            <>
              <SegmentedControl<Mode>
                label={`${slot.label} model source`}
                value={mode}
                onChange={chooseMode}
                options={[
                  ...(isEndpoint
                    ? [
                        {
                          value: 'global' as const,
                          label: 'Follow global',
                          disabled: !g,
                          title: g ? undefined : 'Pick a global model first',
                        },
                      ]
                    : []),
                  { value: 'custom' as const, label: 'Custom' },
                  ...(launchMode ? [{ value: 'temporary' as const, label: 'Temporary' }] : []),
                ]}
              />
              {mode === 'global' && g ? (
                <p className={styles.hint}>Uses the global model. Changing it updates this endpoint.</p>
              ) : null}
              {mode === 'custom' ? (
                <Select
                  label={`${slot.label} project model`}
                  hideLabel
                  items={selectItems}
                  value={binding?.kind === 'connection' ? binding.id : INHERIT}
                  onChange={(k) => {
                    if (k == null || k === INHERIT) bind(null);
                    else bind({ kind: 'connection', id: String(k) });
                  }}
                  help={connections.length ? undefined : 'No project models are available for experiments.'}
                />
              ) : null}
              {binding?.kind === 'temporary' && !formOpen ? (
                <>
                  <TemporaryChip binding={binding}>
                    {follows ? null : (
                      <>
                        <Button variant="ghost" onPress={() => setFormOpen(true)}>
                          Replace
                        </Button>
                        <Button variant="ghost" onPress={() => bind(null)}>
                          Remove
                        </Button>
                      </>
                    )}
                  </TemporaryChip>
                  {binding.needsKey && !binding.secretRef && !follows ? (
                    <ReenterKeyRow slotKey={key} label={slot.label} />
                  ) : null}
                </>
              ) : null}
              {formOpen ? (
                <TemporaryModelForm
                  keysAllowed={keys.allowed}
                  keysReason={keys.reason}
                  canSaveToProject={canManage}
                  allowHttp
                  onCancel={() => setFormOpen(false)}
                  onSubmit={(v) => bind(bindingFromTemporaryForm(v, secrets))}
                />
              ) : null}
              {launchMode && mode !== 'global' && !formOpen ? (
                <div className={styles.row}>
                  <Button variant="neutral" onPress={() => bind(startModelSweep(binding))}>
                    + models
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
        {problems.map((p, i) => (
          <p key={i} className={styles.errorText}>
            {p.message}
          </p>
        ))}
      </div>
    </Card>
  );
}
