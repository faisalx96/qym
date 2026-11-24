import { Link, useSearchParams } from 'react-router-dom';
import type { LiveTurnDetail } from '@/api/live';
import { textDirAttrs } from '@/lib/text';
import { Card, DataTable, EmptyState, StatusMark, Tag, TextBlock } from '@/ui';
import { verdictOf } from '../../lib/mix';
import { TurnCardTitle } from './Evidence';
import { labelFor, liveTime, turnHref } from './presentation';
import styles from '../../turn.module.css';

export function ConversationTab({
  data,
  slug,
  source,
}: {
  data: LiveTurnDetail;
  slug: string;
  source: string;
  zone?: string;
}) {
  const [params] = useSearchParams();
  const list = params.get('list') ?? undefined;
  const siblings = [...data.conversation].sort(
    (a, b) => Date.parse(a.turn_at) - Date.parse(b.turn_at) || (a.turn_index ?? 0) - (b.turn_index ?? 0),
  );
  const href = (turn: LiveTurnDetail['conversation'][number]) => turnHref(slug, source, turn.turn_id, list);
  return (
    <Card
      flush
      className={styles.proseTable}
      data-live-card="conversation"
      header={
        <TurnCardTitle
          title="Turns in this conversation"
          description={`${siblings.length} ${siblings.length === 1 ? 'turn' : 'turns'}. Click a turn to open its page.`}
        />
      }
    >
      {siblings.length ? (
        <DataTable
          aria-label="Conversation turns"
          rows={siblings}
          rowKey={(turn) => turn.turn_id}
          fit="declared"
          columns={[
            {
              id: 'turn',
              header: 'Turn',
              type: 'number',
              align: 'end',
              width: 64,
              cell: (turn) => (turn.turn_index == null ? '—' : turn.turn_index + 1),
            },
            { id: 'time', header: 'Time', type: 'date', width: 136, cell: (turn) => liveTime(turn.turn_at) },
            {
              id: 'question',
              header: 'Question',
              primary: true,
              flex: true,
              minWidth: 180,
              // The wrapper hugs its text, so an Arabic question starts under the header, not at the column's far edge.
              cell: (turn) => (
                <div
                  className={`${styles.question} ${styles.conversationQuestion}`}
                  data-live-question
                  {...textDirAttrs(turn.question)}
                >
                  <TextBlock text={turn.question} code={false} className={styles.conversationQuestion} />
                </div>
              ),
            },
            {
              id: 'result',
              header: 'Result',
              width: 172,
              cell: (turn) => {
                const label = labelFor(turn.label, data.specs);
                const { tone } = verdictOf(label.specTone);
                return (
                  <StatusMark
                    className={styles.conversationResult}
                    label={label.label}
                    tone={tone}
                    data-series={label.series}
                    shape={tone === 'success' ? 'check' : tone === 'danger' ? 'cross' : 'dot'}
                  />
                );
              },
            },
            {
              id: 'open',
              header: '',
              label: 'Open turn',
              hideLabel: true,
              width: 120,
              cell: (turn) =>
                turn.current ? <Tag kind="data">Current turn</Tag> : <Link to={href(turn)}>Open turn</Link>,
            },
          ]}
          rowHref={(turn) => (turn.current ? undefined : href(turn))}
          activeKey={siblings.find((turn) => turn.current)?.turn_id}
          rowProps={(turn) => ({
            'aria-current': turn.current ? 'page' : undefined,
            'data-current': turn.current ? '' : undefined,
          })}
          density="comfortable"
          densityLocked
          variant="embedded"
          responsive="scroll"
          stickyHeader={false}
        />
      ) : (
        <EmptyState compact title="No conversation for this turn" />
      )}
    </Card>
  );
}
