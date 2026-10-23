import { useEffect, useRef, useState } from 'react';
import { Callout } from '@/features/experiments/launch/components/Callout';
import type { ChecklistItem, FeedbackComplexity, FeedbackPriority, Proposal } from '@/api/feedback';
import { Badge, Button, Card, Eyebrow, Select, Text, TextField, Textarea } from '@/ui';
import { gapLabels } from './checklist';
import {
  canSubmit,
  changedFrom,
  COMPLEXITY_HELP,
  formFromProposal,
  hasDuplicate,
  mergeProposal,
  PRIORITY_LABEL,
  submitLabel,
  validate,
  type ProposalForm,
} from './proposalForm';
import { RelatedList } from './RelatedList';
import styles from './feedback.module.css';

const PRIORITIES = (Object.keys(PRIORITY_LABEL) as FeedbackPriority[]).map((k) => ({
  key: k,
  label: PRIORITY_LABEL[k],
}));
export const COMPLEXITY_ITEMS = (['S', 'M', 'L', 'XL'] as FeedbackComplexity[]).map((k) => ({
  key: k,
  label: `${k} · ${COMPLEXITY_HELP[k]}`,
}));

export interface ProposalCardProps {
  proposal: Proposal;
  checklist: ChecklistItem[];
  submitting: boolean;
  /** The assistant is still writing its closing message: Submit waits for it. */
  waiting?: boolean;
  /** Messages from the server: 409 stale, 422 field errors, network failure. */
  stale?: string;
  fieldErrors?: { title?: string; description?: string };
  onSubmit: (form: ProposalForm) => void;
  onKeepTalking: () => void;
  onDirty?: (dirty: boolean) => void;
}

/** The proposed request (QE-57 to QE-76): editable title, description, priority and complexity. */
export function ProposalCard(p: ProposalCardProps) {
  const { proposal } = p;
  const [form, setForm] = useState<ProposalForm>(() => formFromProposal(proposal));
  const [updated, setUpdated] = useState<string[]>([]);
  const lastRef = useRef<Proposal>(proposal);
  useEffect(() => {
    if (lastRef.current.seq === proposal.seq) return;
    const merged = mergeProposal(form, lastRef.current, proposal);
    lastRef.current = proposal;
    setForm(merged.form);
    setUpdated(merged.updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal.seq]);
  const base = formFromProposal(proposal);
  const dirty = JSON.stringify(base) !== JSON.stringify(form);
  const { onDirty } = p;
  useEffect(() => onDirty?.(dirty && !proposal.superseded), [dirty, proposal.superseded, onDirty]);
  const errors = { ...validate(form), ...p.fieldErrors };
  const duplicate = proposal.related.find((r) => r.kind === 'duplicate');
  const shownErrors = errors;

  const heading = (
    <div className={styles.proposalHead}>
      <Text variant="md" as="h2" id="proposal-title" tabIndex={-1}>
        Proposed request
      </Text>
      <Badge tone="warning">{proposal.superseded ? 'Superseded' : 'Not submitted yet'}</Badge>
    </div>
  );
  if (proposal.superseded)
    return (
      <Card
        as="section"
        tone="info"
        aria-labelledby="proposal-title"
        className={styles.proposalCard}
        data-testid="proposal"
        data-superseded=""
        header={heading}
      >
        <p className={styles.footNote}>
          You replied after this proposal. The assistant will propose again when it has what it needs.
        </p>
      </Card>
    );
  return (
    <Card
      as="section"
      tone="info"
      aria-labelledby="proposal-title"
      className={styles.proposalCard}
      data-testid="proposal"
      header={heading}
      footer={
        <div className={styles.proposalFoot}>
          <span className={styles.footNote}>
            Change anything that is wrong. Nothing is submitted until you press the button.
          </span>
          <span className={styles.footActions}>
            <Button variant="neutral" onPress={p.onKeepTalking}>
              Keep talking
            </Button>
            <Button
              variant="accent"
              isDisabled={!canSubmit(form, proposal, p.submitting) || Boolean(p.waiting)}
              loading={p.submitting}
              aria-busy={p.submitting ? true : undefined}
              onPress={() => {
                if (!Object.keys(validate(form)).length) p.onSubmit(form);
              }}
            >
              {submitLabel(proposal)}
            </Button>
          </span>
        </div>
      }
    >
      <div className={styles.proposalBody}>
        {p.stale ? (
          <Callout tone="error" title={p.stale} live>
            Your edits are kept.
          </Callout>
        ) : null}
        {proposal.open_gaps.length ? (
          <Callout tone="warning" title="The assistant did not learn: " live={false}>
            {gapLabels(p.checklist, proposal.open_gaps).join(', ')}
          </Callout>
        ) : null}
        {updated.length ? (
          <p className={styles.footNote} role="status" data-testid="updated-by-assistant">
            Updated by the assistant: {updated.join(', ')}
          </p>
        ) : null}
        {duplicate ? (
          <Callout tone="warning" title={`This looks like a duplicate of ${duplicate.request_id}`} live>
            {duplicate.request_id} “{duplicate.title}” asks for the same thing and is {duplicate.status}. You
            can still submit yours: it is saved as a possible duplicate and an administrator links the two.
          </Callout>
        ) : null}
        <TextField
          label="Title"
          value={form.title}
          onChange={(title) => setForm({ ...form, title })}
          isRequired
          help="Up to 80 characters."
          errorMessage={shownErrors.title}
          maxLength={80}
        />
        <Textarea
          label="Description"
          rows={5}
          value={form.description}
          onChange={(description) => setForm({ ...form, description })}
          isRequired
          errorMessage={shownErrors.description}
        />
        <div className={styles.facts}>
          <div>
            <Eyebrow>Business need</Eyebrow>
            <TextBlockP text={proposal.business_need} />
          </div>
          <div>
            <Eyebrow>Justification</Eyebrow>
            <TextBlockP text={proposal.justification} />
          </div>
        </div>
        <div className={styles.pair}>
          <div className={styles.reasoned} data-reasoned="priority">
            <Select
              label="Priority"
              items={PRIORITIES}
              value={form.priority}
              onChange={(k) => k && setForm({ ...form, priority: k as FeedbackPriority })}
              help={
                changedFrom(form, proposal, 'priority')
                  ? `You changed it from ${changedFrom(form, proposal, 'priority')}.`
                  : undefined
              }
            />
            <span className={styles.reasoning}>
              <Eyebrow>Assistant proposed {PRIORITY_LABEL[proposal.priority.level]}</Eyebrow>
              <span>{proposal.priority.reasoning}</span>
            </span>
          </div>
          <div className={styles.reasoned} data-reasoned="complexity">
            <Select
              label="Complexity"
              items={COMPLEXITY_ITEMS}
              value={form.complexity}
              onChange={(k) => k && setForm({ ...form, complexity: k as FeedbackComplexity })}
              help={
                changedFrom(form, proposal, 'complexity')
                  ? `You changed it from ${changedFrom(form, proposal, 'complexity')}.`
                  : undefined
              }
            />
            <span className={styles.reasoning}>
              <Eyebrow>
                Assistant proposed {proposal.complexity.level} · {COMPLEXITY_HELP[proposal.complexity.level]}
              </Eyebrow>
              <span>{proposal.complexity.reasoning}</span>
            </span>
          </div>
        </div>
        {proposal.related.length ? (
          <RelatedList
            title="Related requests the assistant found"
            items={proposal.related.map((r) => ({
              kind: r.kind,
              ref: r.request_id,
              title: r.title,
              status: r.status,
              note: r.note,
            }))}
          />
        ) : null}
      </div>
    </Card>
  );
}

import { TextBlock } from '@/ui';
function TextBlockP({ text }: { text: string }) {
  return <TextBlock text={text} mode="raw" className={styles.factText} />;
}

export { hasDuplicate };
