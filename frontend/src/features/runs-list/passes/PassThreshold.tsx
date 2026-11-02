/** The pass threshold as one inline slider ("Pass if ≥ ——●—— 80%"): the value is written once, beside the track. */
import { useState } from 'react';
import { Slider } from '@/ui';
import styles from './PassThreshold.module.css';

export function PassThreshold({
  value,
  direction,
  onChange,
}: {
  /** Current threshold (0..1). */
  value: number;
  direction: 'maximize' | 'minimize';
  onChange: (v: number) => void;
}) {
  // the statistics refetch when the thumb is released, not on every step of a drag
  const [draft, setDraft] = useState<number | null>(null);
  const cmp = direction === 'minimize' ? '≤' : '≥';
  return (
    <Slider
      layout="inline"
      className={styles.slider}
      label={`Pass if ${cmp}`}
      minValue={0}
      maxValue={1}
      step={0.05}
      formatOptions={{ style: 'percent', maximumFractionDigits: 0 }}
      value={draft ?? value}
      onChange={(v) => setDraft(v as number)}
      onChangeEnd={(v) => {
        setDraft(null);
        onChange(v as number);
      }}
      data-testid="pass-threshold"
    />
  );
}
