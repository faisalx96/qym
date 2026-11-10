import type { LiveTurnDetail } from '@/api/live';
import { TextBlock } from '@/ui';
import { EvidenceCard } from './Evidence';
import { SqlCompare } from './SqlCompare';
import styles from '../../turn.module.css';

export function AnswerSqlTab({ data }: { data: LiveTurnDetail }) {
  return (
    <>
      <EvidenceCard title="Final answer" block="answer">
        <div data-live-answer dir="auto">
          <TextBlock
            text={data.turn.answer ?? 'No answer available for this turn.'}
            mode="rendered"
            dir="auto"
          />
        </div>
      </EvidenceCard>
      <EvidenceCard title="SQL comparison" block="sql-comparison">
        <p className={styles.copy}>
          Result rows: <span className={styles.number}>{data.turn.result_rows ?? '—'}</span>
        </p>
        <SqlCompare data={data} />
      </EvidenceCard>
    </>
  );
}
