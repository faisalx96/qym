import { useState } from 'react';
import { Button, Tag, Textarea } from '@/ui';
import { useLaunch } from '../LaunchContext';
import {
  configEditEntry,
  configValue,
  formatInput,
  pointerToFieldName,
  setConfig,
  setConfigInput,
  unmatchedConfig,
  unmatchedEntry,
} from '../model';
import styles from './evaluation.module.css';

function Row({ name }: { name: string }) {
  const { doc, setDoc, registerField } = useLaunch();
  const entry = unmatchedEntry('/' + name);
  const edit = configEditEntry(doc, entry, name);
  const invalid = doc.evaluator.invalid[name];
  const text = formatInput(edit, configValue(doc, name), invalid?.raw);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div
      className={`${styles.field} ${styles.fieldWide}`}
      data-eval-field={name}
      ref={(el) => registerField(pointerToFieldName('/evaluator/config/' + name), el)}
    >
      <div className={styles.fieldHead}>
        <span className={styles.mono}>{name}</span>
        <Tag kind="data">json</Tag>
        <span className={styles.spacer} />
        <Button
          variant="ghost"
          aria-label={`Remove ${name}`}
          onPress={() => setDoc((d) => setConfig(d, name, undefined))}
        >
          Remove
        </Button>
      </div>
      <Textarea
        label={name}
        hideLabel
        mono
        rows={3}
        dir="ltr"
        value={draft ?? text}
        onChange={(v) => {
          setDraft(v);
          setDoc((d) => setConfigInput(d, entry, name, v));
        }}
        onBlur={() => setDraft(null)}
        errorMessage={invalid?.message}
      />
    </div>
  );
}

/** evaluator.config keys with a value that no field above shows (B20): nothing is hidden. */
export function OtherValues() {
  const { doc, ctx } = useLaunch();
  const names = unmatchedConfig(doc, ctx.evaluatorPanel);
  if (!names.length) return null;
  return (
    <section className={styles.panel} aria-label="Other values" data-eval-other>
      <h4 className={styles.panelTitle}>Other values</h4>
      <p className={styles.hint}>
        Inputs from the starting point or Raw JSON that this environment’s schema has no field for. They are sent
        as they are.
      </p>
      <div className={styles.grid}>
        {names.map((n) => (
          <Row key={n} name={n} />
        ))}
      </div>
    </section>
  );
}
