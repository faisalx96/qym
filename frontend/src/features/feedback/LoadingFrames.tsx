import type { ChecklistItem } from '@/api/feedback';
import { constrained } from '@/features/shell/layout';
import { Button, Card, PageHeader, Skeleton, TabPanel, Tabs, Tag, Text } from '@/ui';
import { ChecklistRail } from './ChecklistRail';
import styles from './feedback.module.css';

/** The six rows of the loaded rail with nothing known yet: the same markup, so the same height at every width. */
const RAIL: ChecklistItem[] = (
  [
    ['business_need', 'Business need'],
    ['affected', 'Who is affected, how often'],
    ['workaround', 'Current workaround'],
    ['outcome', 'Expected outcome'],
    ['urgency', 'Deadline or urgency'],
    ['scope', 'Scope boundaries'],
  ] as const
).map(([key, label]) => ({ key, label, state: 'open', value: '' }));

/**
 * Loading frames at the loaded layout (QE-125, DESIGN_LANGUAGE section 7): the same header lines, the same
 * chat card (its height is CSS, not content) and the same sections as the loaded page, so nothing moves
 * when the data arrives.
 */
export function ChatLoadingFrame() {
  return (
    <div className={`${constrained} ${styles.page}`} aria-busy="true" data-testid="chat-loading">
      <PageHeader
        title="New feedback"
        description="Answer the assistant’s questions. Nothing is submitted until you confirm a proposal."
        meta={[
          <Tag key="s">Platform</Tag>,
          'Draft, only you can see it',
          'Deleted after 30 days without a submit',
        ]}
        actions={
          <Button variant="danger" size="md" isDisabled>
            Discard draft
          </Button>
        }
      />
      <div className={styles.split} data-chat-split>
        <div className={styles.stackCol}>
          <Card as="section" flush fill aria-label="Loading conversation" className={styles.chatCard}>
            <div className={styles.chatHead}>
              <Text variant="md">Conversation</Text>
            </div>
            <Skeleton kind="rows" rows={3} rowHeight={56} label="Loading conversation" />
          </Card>
        </div>
        <ChecklistRail items={RAIL} />
      </div>
    </div>
  );
}

export function RequestLoadingFrame() {
  return (
    <div className={`${constrained} ${styles.page}`} aria-busy="true" data-testid="request-loading">
      <PageHeader
        title={<Skeleton kind="value" width={320} height={22} label="Loading request" />}
        description={<Skeleton kind="value" width={480} height={13} label="Loading summary" />}
        meta={[
          <Skeleton key="id" kind="value" width={56} height={18} />,
          <Skeleton key="st" kind="value" width={72} height={18} />,
          <Skeleton key="tg" kind="value" width={120} height={13} />,
          <Skeleton key="by" kind="value" width={200} height={13} />,
          <Skeleton key="pr" kind="value" width={96} height={13} />,
          <Skeleton key="cx" kind="value" width={96} height={13} />,
        ]}
      />
      <Tabs
        label="Request sections"
        items={[
          { id: 'request', label: 'Request' },
          { id: 'conversation', label: 'Conversation' },
        ]}
        selected="request"
        onSelect={() => undefined}
      >
        <TabPanel id="request">
          <div className={styles.split} data-request-split>
            <div className={styles.stackCol}>
              <Card as="section" aria-label="Loading request">
                <Skeleton kind="rows" rows={4} rowHeight={48} label="Loading request" />
              </Card>
              <Card as="section" aria-label="Loading history" header={<Text variant="md">History</Text>}>
                <Skeleton kind="rows" rows={1} rowHeight={40} label="Loading history" />
              </Card>
            </div>
          </div>
        </TabPanel>
        <TabPanel id="conversation">{null}</TabPanel>
      </Tabs>
    </div>
  );
}
