import { Link } from 'react-router-dom';
import type { LiveTurnDetail } from '@/api/live';
import { Text } from '@/ui';
import { DiagnosisLabel } from './Evidence';
import { turnHref, turnTime } from './presentation';
import styles from '../../turn.module.css';

export function ConversationTab({
  data,
  slug,
  source,
  zone,
}: {
  data: LiveTurnDetail;
  slug: string;
  source: string;
  zone?: string;
}) {
  const siblings = [...data.conversation].sort(
    (a, b) => a.turn_at.localeCompare(b.turn_at) || (a.turn_index ?? 0) - (b.turn_index ?? 0),
  );
  if (!siblings.length) return <Text tone="muted">No conversation available for this turn.</Text>;
  return (
    <ol className={styles.conversation} aria-label="Conversation turns">
      {siblings.map((sibling) => (
        <li key={sibling.turn_id} data-current={sibling.current ? '' : undefined}>
          <div className={styles.inline}>
            <span className={styles.number}>{turnTime(sibling.turn_at, zone)}</span>
            <DiagnosisLabel value={sibling.label} specs={data.specs} />
            {sibling.current ? <Text weight={600}>Current turn</Text> : null}
          </div>
          <Link
            to={turnHref(slug, source, sibling.turn_id)}
            aria-current={sibling.current ? 'page' : undefined}
            dir="auto"
            data-live-question
          >
            {sibling.question}
          </Link>
        </li>
      ))}
    </ol>
  );
}
