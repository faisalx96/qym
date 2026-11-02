import type { ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger,
  type TooltipProps as AriaTooltipProps,
} from 'react-aria-components';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  content: ReactNode;
  delay?: number;
  placement?: AriaTooltipProps['placement'];
  /** A focusable React Aria trigger (Button/IconButton). */
  children: ReactNode;
}

/** Plain tooltip for icon-only actions; hover + focus. */
export function Tooltip({ content, delay = 400, placement = 'top', children }: TooltipProps) {
  return (
    <TooltipTrigger delay={delay}>
      {children}
      <AriaTooltip className={styles.tooltip} placement={placement} offset={6}>
        <OverlayArrow className={styles.arrow}>
          <svg width={8} height={8} viewBox="0 0 8 8" aria-hidden="true">
            <path d="M0 0 L4 4 L8 0" />
          </svg>
        </OverlayArrow>
        {content}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
