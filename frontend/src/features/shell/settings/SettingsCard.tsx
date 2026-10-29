import { useId, type ReactNode } from 'react';
import { Card, Text, type CardTone } from '@/ui';
import styles from './settings.module.css';

export interface SettingsCardProps {
  /** Anchor for links that jump to this block. */
  id?: string;
  title: ReactNode;
  /** One line under the title: what the block is for. */
  description?: ReactNode;
  /** The block's main action (Add, Create), on the title row's end side. */
  action?: ReactNode;
  footer?: ReactNode;
  tone?: CardTone;
  children?: ReactNode;
  [data: `data-${string}`]: string | boolean | undefined;
}

/**
 * One settings block: a card with a title, a description line and the block's action on the right, then its
 * content. Every settings tab is built from these, so each tab opens the same way (round 10, as the old settings
 * page did): title, subtitle, then the controls.
 */
export function SettingsCard({
  id: anchor,
  title,
  description,
  action,
  footer,
  tone,
  children,
  ...rest
}: SettingsCardProps) {
  const id = useId();
  return (
    <Card
      as="section"
      id={anchor}
      aria-labelledby={id}
      tone={tone}
      footer={footer}
      header={
        <div className={styles.cardHeader}>
          <div>
            <Text variant="md" id={id}>
              {title}
            </Text>
            {description ? <Text variant="sm">{description}</Text> : null}
          </div>
          {action ? <div className={styles.cardAction}>{action}</div> : null}
        </div>
      }
      {...rest}
    >
      <div className={styles.cardBody}>{children}</div>
    </Card>
  );
}
