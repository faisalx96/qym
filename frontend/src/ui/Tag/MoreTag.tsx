import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';
import { Icon } from '../Icon';
import styles from './Tag.module.css';

/** '+N more': the count Tag as a button that shows the hidden tags (A-20). `chevron` adds a 12px chevron-down. */
export function MoreTag({
  count,
  chevron,
  ...rest
}: { count: number; chevron?: boolean } & Omit<AriaButtonProps, 'children' | 'className'>) {
  return (
    <AriaButton {...rest} className={styles.more} data-kind="count">
      +{count} more{chevron ? <Icon name="chevron-down" size={12} /> : null}
    </AriaButton>
  );
}
