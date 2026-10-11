import { useEffect, type ReactNode, type RefObject } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { IconButton } from '../IconButton';
import styles from './Dialog.module.css';

export type DialogSize = 'sm' | 'md' | 'lg' | 'data';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  role?: 'dialog' | 'alertdialog';
  /** Element focused on open; default: first [autofocus] / focusable. */
  initialFocus?: RefObject<HTMLElement | null>;
  dismissOnBackdrop?: boolean;
  /** Escape closes (default true). */
  isKeyboardDismissDisabled?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
  /** Hide the × close button. */
  hideClose?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * Body-mounted modal (.shell-modal). React Aria gives focus trap, restore,
 * stack, Escape and inert-outside. 440px default; data = 760px.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  role = 'dialog',
  initialFocus,
  dismissOnBackdrop = true,
  isKeyboardDismissDisabled,
  footer,
  children,
  hideClose,
  className,
  ...rest
}: DialogProps) {
  useEffect(() => {
    if (!open || !initialFocus) return;
    // After React Aria's own focus-scope pass, move focus to the requested element once.
    initialFocus.current?.focus();
    const frame = requestAnimationFrame(() => initialFocus.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, initialFocus]);
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable={dismissOnBackdrop}
      isKeyboardDismissDisabled={isKeyboardDismissDisabled}
      className={styles.backdrop}
    >
      <Modal className={[styles.modal, className].filter(Boolean).join(' ')} data-size={size}>
        <AriaDialog
          role={role}
          className={styles.dialog}
          data-testid={rest['data-testid']}
          // React Aria hides the rest of the page (aria-hidden) and filters aria-modal; set it for AT parity with the legacy contract.
          ref={(el) => el?.setAttribute('aria-modal', 'true')}
        >
          {({ close }) => (
            <>
              <header className={styles.header}>
                <Heading slot="title" className={styles.title}>
                  {title}
                </Heading>
                {!hideClose ? <IconButton label="Close" icon="close" onPress={close} /> : null}
              </header>
              {description ? <p className={styles.description}>{description}</p> : null}
              <div className={styles.body}>{children}</div>
              {footer ? <footer className={styles.footer}>{footer}</footer> : null}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
