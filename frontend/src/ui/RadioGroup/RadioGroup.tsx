import type { ReactNode } from 'react';
import { Radio, RadioGroup as AriaRadioGroup } from 'react-aria-components';
import styles from './RadioGroup.module.css';

export interface RadioOption<K extends string> {
  value: K;
  /** The option's name (`--font-md`, 600). */
  title: ReactNode;
  /** One sentence under the title (`--font-sm`, muted). */
  help?: ReactNode;
  disabled?: boolean;
  testId?: string;
}

export interface RadioGroupProps<K extends string> {
  /** Accessible name of the group. */
  label: string;
  options: RadioOption<K>[];
  value: K;
  onChange: (value: K) => void;
  className?: string;
  isDisabled?: boolean;
  testId?: string;
}

/**
 * Option rows with a title and a help sentence: the choice between a few modes that need
 * a sentence each (a 24px SegmentedControl cannot carry them). One Tab stop; Arrow keys
 * move and select; Space selects. `role="radiogroup"` / `role="radio"` from React Aria.
 */
export function RadioGroup<K extends string>({
  label,
  options,
  value,
  onChange,
  className,
  isDisabled,
  testId,
}: RadioGroupProps<K>) {
  return (
    <AriaRadioGroup
      aria-label={label}
      value={value}
      onChange={(v) => onChange(v as K)}
      isDisabled={isDisabled}
      className={[styles.options, className].filter(Boolean).join(' ')}
      data-testid={testId}
    >
      {options.map((opt) => (
        <Radio
          key={opt.value}
          value={opt.value}
          isDisabled={opt.disabled}
          className={styles.option}
          data-testid={opt.testId}
        >
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.optionText}>
            <span className={styles.optionTitle}>{opt.title}</span>
            {opt.help ? <span className={styles.optionHelp}>{opt.help}</span> : null}
          </span>
        </Radio>
      ))}
    </AriaRadioGroup>
  );
}
