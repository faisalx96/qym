/** The pass-threshold chip ("Pass if >= 80%") and the popover that edits it (slider, number, presets, reset). */
import { useState } from 'react';
import { Button, NumberField, Popover, Slider, Text } from '@/ui';
import styles from './PassThreshold.module.css';

const PRESETS = [0.5, 0.7, 0.8, 0.9];

export function PassThreshold({
  value,
  defaultValue,
  direction,
  onChange,
  onReset,
}: {
  /** Current threshold (0..1). */
  value: number;
  /** The server rule's / metric's default; Reset returns to it. */
  defaultValue: number;
  direction: 'maximize' | 'minimize';
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const cmp = direction === 'minimize' ? '≤' : '≥';
  const pct = (v: number) => Math.round(v * 100);
  const shown = draft ?? value;
  return (
    <Popover
      label="Pass threshold"
      placement="bottom end"
      trigger={
        <Button
          variant="neutral"
          data-testid="pass-threshold-chip"
          aria-label={`Pass threshold: pass if ${cmp} ${pct(value)}%. Edit`}
        >
          Pass if {cmp} {pct(value)}%
        </Button>
      }
    >
      <div className={styles.body}>
        <Text variant="sm" tone="muted" as="p">
          {direction === 'minimize'
            ? 'An item passes when its score is at or below this threshold.'
            : 'An item passes when its score meets or exceeds this threshold.'}
        </Text>
        <Slider
          label="Pass threshold"
          minValue={0}
          maxValue={1}
          step={0.05}
          value={shown}
          onChange={(v) => setDraft(v as number)}
          onChangeEnd={(v) => {
            setDraft(null);
            onChange(v as number);
          }}
        />
        <NumberField
          label="Threshold (%)"
          minValue={0}
          maxValue={100}
          step={5}
          value={pct(shown)}
          onChange={(n) => {
            if (Number.isFinite(n)) onChange(Math.min(100, Math.max(0, n)) / 100);
          }}
          width={110}
        />
        <div className={styles.presets}>
          {PRESETS.map((p) => (
            <Button
              key={p}
              variant={pct(value) === pct(p) ? 'accent' : 'neutral'}
              onPress={() => onChange(p)}
            >
              {pct(p)}%
            </Button>
          ))}
          <Button variant="ghost" isDisabled={pct(value) === pct(defaultValue)} onPress={onReset}>
            Reset to {pct(defaultValue)}%
          </Button>
        </div>
      </div>
    </Popover>
  );
}
