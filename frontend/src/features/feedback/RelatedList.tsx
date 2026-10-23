import { Eyebrow } from '@/ui';
import type { FeedbackStatus, RelatedKind } from '@/api/feedback';
import { KindBadge, StatusBadge } from './badges';
import { RequestLink } from './RequestLink';
import styles from './feedback.module.css';

export interface RelatedEntry {
  kind: RelatedKind;
  ref: string;
  title: string;
  status: FeedbackStatus;
  note: string;
}

export function RelatedList({ items, title }: { items: RelatedEntry[]; title?: string }) {
  if (!items.length) return null;
  return (
    <div className={styles.related} data-testid="related">
      {title ? <Eyebrow>{title}</Eyebrow> : null}
      <ul className={styles.relatedList} aria-label="Related requests">
        {items.slice(0, 6).map((r) => (
          <li key={`${r.kind}-${r.ref}`} className={styles.relatedItem} data-kind={r.kind} data-related={r.ref}>
            <span className={styles.relatedHead}>
              <KindBadge kind={r.kind} />
              <RequestLink id={r.ref} />
              <StatusBadge status={r.status} />
            </span>
            <span className={styles.relatedTitle}>{r.title}</span>
            <span className={styles.relatedNote}>{r.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
