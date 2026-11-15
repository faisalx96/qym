import { ClampedText, Subsection, Text, TextBlock } from '@/ui';
import { questionContextOf, stringOf } from '../../lib/summary';
import styles from './QuestionContext.module.css';

export function QuestionContext({ summary }: { summary: Record<string, unknown> }) {
  const context = questionContextOf(summary);
  const fields = [
    { label: 'Standalone question', value: context?.enrichedQuestion },
    { label: 'Previous question', value: context?.previousQuestion, clamp: true },
    { label: 'Previous answer', value: context?.previousAnswer, clamp: true },
    {
      label: 'Selected excerpt',
      value: context?.selectedExcerpt ?? stringOf(summary.selected_excerpt),
      clamp: true,
    },
    { label: 'Question prompt', value: stringOf(summary.question_prompt), clamp: true },
  ].filter((field) => field.value);
  if (!fields.length) return null;
  return (
    <Subsection title="Question context">
      <div className={styles.fields}>
        {fields.map(({ label, value, clamp }) => (
          <div key={label}>
            <Text as="p" tone="muted" weight={600}>
              {label}
            </Text>
            {clamp ? (
              <ClampedText text={value!} lines={3} code={false} />
            ) : (
              <TextBlock text={value!} code={false} />
            )}
          </div>
        ))}
      </div>
    </Subsection>
  );
}
