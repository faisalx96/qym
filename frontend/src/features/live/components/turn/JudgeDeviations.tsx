import { Tag, Text, TextBlock } from '@/ui';
import { deviationEvidence } from './deviationEvidence';
import { Bilingual } from './Evidence';
import styles from './JudgeDeviations.module.css';

export function JudgeDeviations({ summary, side }: { summary: Record<string, unknown>; side: 'a' | 'b' }) {
  const deviations = deviationEvidence(summary, side);
  if (!deviations.length) return null;
  return (
    <ul className={styles.list}>
      {deviations.map((item, index) => (
        <li key={index} className={styles.deviation} data-dropped={item.dropped ? 'true' : undefined}>
          <div className={styles.labels}>
            {item.axis ? <Tag>{item.axis}</Tag> : null}
            {item.type ? (
              <Text as="span" dir="auto">
                {item.type}
              </Text>
            ) : null}
          </div>
          <Bilingual en={item.textEn || null} ar={item.textAr || null} />
          {item.quote ? (
            <TextBlock text={item.quote} dir="auto" code={false} className={styles.quote} />
          ) : null}
          {item.dropped ? (
            <Text as="p" tone="muted">
              Not counted: {item.droppedReason || 'set aside by the evaluator.'}
            </Text>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
