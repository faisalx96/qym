import { useState } from 'react';
import { Button, Chip, Tag } from '@/ui';
import { TemporaryModelForm } from '@/features/environments/TemporaryModelForm';
import { useLaunch } from '../LaunchContext';
import {
  canEnterKeys,
  modelItemFromBinding,
  sweepItemKey,
  temporaryBinding,
  toggleModelItem,
  upsertModelItem,
  type SlotConnection,
  type SweepModelItem,
} from '../model';
import { connectionLabel } from './keys';
import styles from './models.module.css';

export interface SweepChipsProps {
  /** "Primary model" / "Global model": names the group. */
  label: string;
  items: SweepModelItem[];
  connections: SlotConnection[];
  onChange: (items: SweepModelItem[]) => void;
  /** "Single model": stop sweeping. */
  onSingle: () => void;
}

function temporaryText(item: SweepModelItem): string {
  if ('temporary' in item) return item.temporary.label || item.temporary.model;
  if ('connection_id' in item) return item.connection_id;
  return 'Inherit';
}

/**
 * A model sweep: every picked model is one run. Chips toggle project models (and Inherit);
 * swept temporary models appear as removable chips. Keys of swept temporary models go to the
 * SecretStore like any other.
 */
export function SweepChips({ label, items, connections, onChange, onSingle }: SweepChipsProps) {
  const { ctx, secrets } = useLaunch();
  const [formOpen, setFormOpen] = useState(false);
  const keys = canEnterKeys(ctx);
  const chosen = new Set(items.map(sweepItemKey));
  const known = new Set(['inherit', ...connections.map((c) => 'c:' + c.id)]);
  const extras = items.filter((i) => !known.has(sweepItemKey(i)));
  const unavailable = connections.filter((c) => !c.available);

  return (
    <div className={styles.stack} data-model-sweep>
      <div className={styles.chips} role="group" aria-label={`${label} models to sweep`}>
        <Chip
          isSelected={chosen.has('inherit')}
          onChange={() => onChange(toggleModelItem(items, { inherit: true }))}
        >
          Inherit
        </Chip>
        {connections.map((c) => (
          <Chip
            key={c.id}
            isSelected={chosen.has('c:' + c.id)}
            isDisabled={!c.available && !chosen.has('c:' + c.id)}
            onChange={() => onChange(toggleModelItem(items, { connection_id: c.id }))}
          >
            {connectionLabel(c)}
          </Chip>
        ))}
        {extras.map((item) => {
          const key = sweepItemKey(item);
          const temporary = 'temporary' in item;
          const hasKey = temporary && Boolean(item.temporary.api_key?.$secret);
          return (
            <span key={key} className={styles.row} role="group" aria-label={temporaryText(item)}>
              <Chip
                isSelected
                onChange={() => onChange(items.filter((x) => sweepItemKey(x) !== key))}
                onRemove={() => onChange(items.filter((x) => sweepItemKey(x) !== key))}
                removeLabel={`Remove ${temporaryText(item)}`}
              >
                {temporaryText(item)}
              </Chip>
              {temporary && !hasKey ? <Tag tone="danger">no API key</Tag> : null}
              {!temporary ? <Tag tone="warning">not available</Tag> : null}
            </span>
          );
        })}
      </div>
      {unavailable.length ? (
        <p className={styles.hint}>
          Not usable here:{' '}
          {unavailable.map((c) => `${c.name} (${c.reasons.join('; ') || 'not available'})`).join(' · ')}
        </p>
      ) : null}
      {!items.length ? (
        <p className={styles.errorText} role="alert">
          Pick at least one model, or switch back to a single model.
        </p>
      ) : null}
      {formOpen ? (
        <TemporaryModelForm
          keysAllowed={keys.allowed}
          keysReason={keys.reason}
          canSaveToProject={false}
          allowHttp
          onCancel={() => setFormOpen(false)}
          onSubmit={(v) => {
            const ref = v.api_key ? secrets.put(v.api_key) : null;
            const item = modelItemFromBinding(
              temporaryBinding({ label: v.label, model: v.model, baseUrl: v.base_url, secretRef: ref }),
            );
            setFormOpen(false);
            if (item) onChange(upsertModelItem(items, item));
          }}
        />
      ) : null}
      <div className={styles.row}>
        <span className={`${styles.hint} ${styles.mono}`}>
          {items.length} model{items.length === 1 ? '' : 's'}
        </span>
        {!formOpen ? (
          <Button variant="neutral" onPress={() => setFormOpen(true)}>
            + Temporary model
          </Button>
        ) : null}
        <span className={styles.spacer} />
        <Button variant="ghost" onPress={onSingle}>
          Single model
        </Button>
      </div>
    </div>
  );
}
