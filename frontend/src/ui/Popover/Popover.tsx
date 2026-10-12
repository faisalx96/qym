import type { ReactNode } from 'react';
import {
  Dialog,
  DialogTrigger,
  Popover as AriaPopover,
  type PopoverProps as AriaPopoverProps,
} from 'react-aria-components';
import styles from './Popover.module.css';

export interface PopoverProps {
  /** A React Aria pressable (Button, IconButton …). */
  trigger: ReactNode;
  placement?: AriaPopoverProps['placement'];
  label: string;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
}

/** Non-modal popover: outside click / Escape close, focus returns to the trigger. */
export function Popover({
  trigger,
  placement = 'bottom start',
  label,
  isOpen,
  onOpenChange,
  className,
  children,
}: PopoverProps) {
  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      {trigger}
      <AriaPopover
        placement={placement}
        offset={6}
        className={[styles.popover, className].filter(Boolean).join(' ')}
      >
        <Dialog aria-label={label} className={styles.dialog}>
          {({ close }) => (typeof children === 'function' ? children({ close }) : children)}
        </Dialog>
      </AriaPopover>
    </DialogTrigger>
  );
}
