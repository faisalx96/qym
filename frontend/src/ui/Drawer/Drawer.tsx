import type { ReactNode } from 'react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { IconButton } from '../IconButton';
import styles from './Drawer.module.css';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  width?: number;
  actions?: ReactNode;
  footer?: ReactNode;
  dismissOnBackdrop?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * Right-side panel (.shell-drawer). Unmounted when closed, so there is nothing
 * to mark inert/aria-hidden; the focus contract comes from React Aria.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  subtitle,
  width = 480,
  actions,
  footer,
  dismissOnBackdrop = true,
  children,
  className,
}: DrawerProps) {
  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable={dismissOnBackdrop}
      className={styles.backdrop}
    >
      <Modal className={[styles.drawer, className].filter(Boolean).join(' ')} style={{ width }}>
        <AriaDialog className={styles.dialog} ref={(el) => el?.setAttribute('aria-modal', 'true')}>
          {({ close }) => (
            <>
              <header className={styles.header}>
                <div className={styles.titles}>
                  <Heading slot="title" className={styles.title}>
                    {title}
                  </Heading>
                  {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
                </div>
                <div className={styles.actions}>
                  {actions}
                  <IconButton label="Close" icon="close" onPress={close} />
                </div>
              </header>
              <div className={styles.body}>{children}</div>
              {footer ? <footer className={styles.footer}>{footer}</footer> : null}
            </>
          )}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
