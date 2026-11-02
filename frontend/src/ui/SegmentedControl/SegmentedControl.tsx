import type { ReactNode } from 'react';
import { Radio, RadioGroup } from 'react-aria-components';
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<K extends string> {
  value: K;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<K extends string> {
  label: string;
  options: SegmentedOption<K>[];
  value: K;
  onChange: (value: K) => void;
  className?: string;
  isDisabled?: boolean;
}

/**
 * .qym-segmented: one Tab stop, Arrow keys move the selection (radiogroup). The selected option draws its own accent
 * wash, so nothing is measured on render (C020).
 */
export function SegmentedControl<K extends string>({
  label,
  options,
  value,
  onChange,
  className,
  isDisabled,
}: SegmentedControlProps<K>) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onChange={(v) => onChange(v as K)}
      orientation="horizontal"
      isDisabled={isDisabled}
      className={[styles.segmented, className].filter(Boolean).join(' ')}
    >
      {options.map((opt) => (
        <Radio
          key={opt.value}
          value={opt.value}
          isDisabled={opt.disabled}
          className={styles.option}
          data-title={opt.title}
        >
          {opt.label}
        </Radio>
      ))}
    </RadioGroup>
  );
}
