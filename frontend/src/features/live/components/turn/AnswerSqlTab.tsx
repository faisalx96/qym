import type { LiveTurnDetail } from '@/api/live';
import { textDirAttrs } from '@/lib/text';
import { EmptyState, FieldRow, StatusMark, Tag, Text, TextBlock } from '@/ui';
import { EvidenceCard } from './Evidence';
import { SqlCompare } from './SqlCompare';
import styles from '../../turn.module.css';

export function AnswerSqlTab({
  data,
  modelIndex,
}: {
  data: LiveTurnDetail;
  modelIndex?: Record<string, number> | null;
}) {
  const answer = data.turn.answer ?? '';
  const fragments = answer.split(/(\[\[viz:[^\]\r\n]+\]\])/g);
  const placeholders = fragments.filter((_, index) => index % 2 === 1);
  const prose = fragments.filter((_, index) => index % 2 === 0).join('');
  const errorDetection = data.scores.find((score) => score.metric_name === 'error_detection');
  const errorScore = errorDetection?.skipped ? null : (errorDetection?.score_numeric ?? null);
  return (
    <>
      <EvidenceCard title="Final answer" block="answer">
        <div className={styles.finalAnswer} data-live-answer {...textDirAttrs(prose)}>
          {answer ? (
            fragments.map((fragment, index) =>
              index % 2 ? (
                <Tag key={index} dir="ltr">
                  Chart shown here
                </Tag>
              ) : fragment ? (
                <TextBlock
                  key={index}
                  text={fragment}
                  mode="rendered"
                  code={false}
                  dir="auto"
                  className={styles.answerFragment}
                />
              ) : null,
            )
          ) : (
            <EmptyState compact title="No answer available for this turn" />
          )}
        </div>
        <FieldRow label="Error detection" labelAnchor="start" labelCase="sentence">
          <StatusMark
            tone={errorScore === 1 ? 'success' : errorScore === 0 ? 'danger' : 'neutral'}
            shape={errorScore === 1 ? 'check' : errorScore === 0 ? 'cross' : 'ring'}
            label={
              errorScore === 1
                ? 'Pass'
                : errorScore === 0
                  ? 'Fail'
                  : errorScore === null
                    ? 'Not evaluated'
                    : `${Math.round(errorScore * 100)}%`
            }
          />
        </FieldRow>
        {placeholders.length ? (
          <FieldRow label="Chart placeholder" labelAnchor="start" labelCase="sentence">
            <div className={styles.stack}>
              {[...new Set(placeholders)].map((placeholder) => (
                <Text key={placeholder} mono dir="ltr">
                  {placeholder}
                </Text>
              ))}
            </div>
          </FieldRow>
        ) : null}
      </EvidenceCard>
      <SqlCompare data={data} modelIndex={modelIndex} />
    </>
  );
}
