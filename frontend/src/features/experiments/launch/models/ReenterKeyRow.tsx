import { useRef, useState } from 'react';
import { Button, TextField } from '@/ui';
import { useLaunch } from '../LaunchContext';
import { canEnterKeys, reenterKey } from '../model';
import { reenterGlobalKey } from './keys';
import styles from './models.module.css';

export interface ReenterKeyRowProps {
  /** Slot key, or null for the global model. */
  slotKey: string | null;
  label: string;
}

/**
 * A temporary model that came without its key (clone, preset, best run): type the key again, or
 * launch without one. The key goes to the SecretStore and the field is wiped; the document only
 * ever holds the ref.
 */
export function ReenterKeyRow({ slotKey, label }: ReenterKeyRowProps) {
  const { ctx, setDoc, secrets } = useLaunch();
  const keys = canEnterKeys(ctx);
  const typed = useRef('');
  const [generation, setGeneration] = useState(0);
  if (!keys.allowed) return <p className={styles.hint}>Its API key was not copied. {keys.reason}</p>;

  function applyKey() {
    const key = typed.current.trim();
    typed.current = '';
    setGeneration((n) => n + 1); // remounts the field, which drops its text
    if (!key) return;
    const ref = secrets.put(key);
    setDoc((d) => (slotKey === null ? reenterGlobalKey(d, ctx, ref) : reenterKey(d, slotKey, ref)));
  }

  return (
    <div data-reenter-key={slotKey ?? 'global'}>
      <p className={styles.hint}>
        Its API key was not copied.{' '}
        {slotKey === null ? 'Enter it once for every endpoint, or' : 'Enter it again, or'} launch without a
        key.
      </p>
      <div className={styles.keyRow}>
        <TextField
          key={generation}
          className={styles.grow}
          label={`API key for ${label}`}
          type="password"
          mono
          autoComplete="off"
          placeholder="sk-…"
          onChange={(v) => {
            typed.current = v;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyKey();
            }
          }}
        />
        <Button variant="neutral" onPress={applyKey}>
          Use key
        </Button>
      </div>
    </div>
  );
}
