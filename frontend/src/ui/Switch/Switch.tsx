import type { ReactNode } from 'react';
import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from 'react-aria-components';
import styles from './Switch.module.css';

export interface SwitchProps extends Omit<AriaSwitchProps, 'className' | 'style' | 'children'> {
  children?: ReactNode;
  className?: string;
}

export function Switch({ children, className, ...rest }: SwitchProps) {
  return (
    <AriaSwitch className={[styles.switch, className].filter(Boolean).join(' ')} {...rest}>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      {children ? <span>{children}</span> : null}
    </AriaSwitch>
  );
}
