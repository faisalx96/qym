import type { LiveTurnDetail } from '@/api/live';
import { TextBlock } from '@/ui';
import { sqlPartsOf } from '../../lib/summary';
import { EvidenceCard, SqlParts } from './Evidence';
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
      <EvidenceCard title="Agent SQL" block="agent-sql">
        <p className={styles.copy}>
          Result rows: <span className={styles.number}>{data.turn.result_rows ?? '—'}</span>
        </p>
        <SqlParts parts={sqlPartsOf(data.turn.sql)} />
      </EvidenceCard>
    </>
  );
}
