import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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
 * .qym-segmented: one Tab stop, Arrow keys move the selection (radiogroup);
 * one sliding indicator; no motion under prefers-reduced-motion.
 */
export function SegmentedControl<K extends string>({
  label,
  options,
  value,
  onChange,
  className,
  isDisabled,
}: SegmentedControlProps<K>) {
  const groupRef = useRef<HTMLDivElement>(null);
  // a fresh `options` array on every parent render must not re-measure (a forced layout inside scroll commits)
  const optionsKey = options.map((o) => o.value).join('\u0001');
  const [indicator, setIndicator] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const update = () => {
      const active = group.querySelector<HTMLElement>('[data-selected]');
      if (!active) return setIndicator(null);
      const x = active.offsetLeft;
      const w = active.offsetWidth;
      setIndicator((p) => (p && p.x === x && p.w === w ? p : { x, w }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(group);
    return () => ro.disconnect();
  }, [value, optionsKey]);
  return (
    <RadioGroup
      ref={groupRef}
      aria-label={label}
      value={value}
      onChange={(v) => onChange(v as K)}
      orientation="horizontal"
      isDisabled={isDisabled}
      className={[styles.segmented, className].filter(Boolean).join(' ')}
      data-ready={indicator ? '' : undefined}
      style={
        indicator
          ? ({
              '--qym-segment-x': `${indicator.x}px`,
              '--qym-segment-width': `${indicator.w}px`,
            } as React.CSSProperties)
          : undefined
      }
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
