import type { ChecklistItem } from '@/api/feedback';
import { Card, Icon, Tag, Text } from '@/ui';
import { knownCount, STATE_WORD } from './checklist';
import styles from './feedback.module.css';

/** What the assistant has so far (QE-44 to QE-47): six items, a word and a glyph for each state. */
export function ChecklistRail({ items }: { items: ChecklistItem[] }) {
  return (
    <Card
      as="aside"
      aria-label="What the assistant has so far"
      data-testid="checklist"
      header={
        <div className={styles.railHead}>
          <Text variant="md">What the assistant has so far</Text>
          <Tag kind="count">
            {knownCount(items)} of {items.length}
          </Tag>
        </div>
      }
    >
      <ul className={styles.checklist} aria-label="Information checklist">
        {items.map((i) => (
          <li key={i.key} className={styles.checkItem} data-state={i.state} data-check={i.key}>
            <span className={styles.checkGlyph} aria-hidden="true">
              {i.state === 'filled' ? <Icon name="check" size={12} /> : i.state === 'declined' ? <Icon name="minus" size={12} /> : null}
            </span>
            <span className={styles.checkText}>
              <span className={styles.checkLabel}>
                {i.label}
                <span className={styles.srOnly}>: {STATE_WORD[i.state]}</span>
              </span>
              {i.value ? <span className={styles.checkValue}>{i.value}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
