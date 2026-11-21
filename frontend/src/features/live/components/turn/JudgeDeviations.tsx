import { DataTable, Text, TextBlock } from '@/ui';
import { deviationEvidence } from './deviationEvidence';
import { Bilingual } from './Evidence';
import styles from './JudgeDeviations.module.css';

export function JudgeDeviations({ summary, side }: { summary: Record<string, unknown>; side: 'a' | 'b' }) {
  const deviations = deviationEvidence(summary, side);
  if (!deviations.length)
    return (
      <Text as="p" tone="muted">
        No deviations found.
      </Text>
    );
  return (
    <DataTable
      aria-label={`Judge ${side.toUpperCase()} deviations`}
      rows={deviations.map((item, index) => ({ ...item, index }))}
      rowKey={(row) => String(row.index)}
      rowProps={(row) => ({ 'data-dropped': row.dropped ? 'true' : undefined })}
      columns={[
        {
          id: 'where',
          header: 'Where',
          width: 110,
          cell: (row) => (
            <TextBlock
              code={false}
              text={
                [
                  row.axis === 'sql' ? 'SQL' : row.axis === 'response' ? 'Response' : null,
                  row.type?.replaceAll('_', ' '),
                ]
                  .filter(Boolean)
                  .join(': ') || 'Not specified'
              }
            />
          ),
        },
        {
          id: 'finding',
          header: 'What the judge found',
          flex: true,
          minWidth: 160,
          cell: (row) => (
            <div className={styles.finding} data-dropped={row.dropped ? 'true' : undefined}>
              <Bilingual en={row.textEn} ar={row.textAr} />
              {row.quote ? <TextBlock text={row.quote} code={false} className={styles.quote} /> : null}
              {row.dropped ? (
                <Text as="p" tone="muted">
                  Not counted: {row.droppedReason || 'set aside by the evaluator.'}
                </Text>
              ) : null}
            </div>
          ),
        },
      ]}
      fit="declared"
      variant="embedded"
      density="comfortable"
      densityLocked
      stickyHeader={false}
      responsive="scroll"
    />
  );
}
