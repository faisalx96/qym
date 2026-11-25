import { useState } from 'react';
import type { LiveTurnDetail } from '@/api/live';
import { splitBilingual } from '@/lib/text';
import { formatPercentValue } from '@/lib/format';
import { verdictOf as verdictTone } from '../../lib/mix';
import { EmptyState, Button, Card, DataTable, Disclosure, StatusMark, Tag, Text } from '@/ui';
import { numberOf, recordOf, rulesAppliedOf, verdictOf } from '../../lib/summary';
import { Bilingual, RulesApplied } from './Evidence';
import { labelFor, liveTime } from './presentation';
import type { PreviousVerdict } from './Reevaluation';
import styles from './DiagnosisVerdict.module.css';
import turnStyles from '../../turn.module.css';

const basisWords = {
  rule: 'an Insightor rule',
  judges: 'the two judges',
  outcome: 'how the turn ended',
  skipped: 'not evaluated',
};
const kindWords: Record<string, string> = { fact: 'Trace fact', replay: 'Re-run', judge: 'Judge score' };
const sentenceCase = (value: string) => {
  const words = value.replaceAll('_', ' ').replaceAll('-', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function stepEvidence(source: string | null, kind: string | null) {
  if (!source) return null;
  // Source locations are implementation detail, not evidence for the reader.
  if (/[\\/]|\.(?:md|py|tsx?|jsx?|json|ya?ml|sql|txt)$|:\d+(?:-\d+)?$/i.test(source)) return null;
  if (/^(?:tool|judge|rule|service):\s*\S/i.test(source)) return source;
  if ((kind === 'judge' || kind === 'replay') && /^[ab]$/i.test(source))
    return `Judge: ${source.toUpperCase()}`;
  return `${kind === 'rule' ? 'Rule' : kind === 'service' ? 'Service' : 'Evidence'}: ${source}`;
}

export function DiagnosisVerdict({
  data,
  reevaluating = false,
  previous = null,
}: {
  data: LiveTurnDetail;
  /** This turn is being redone: the mark says so and the explanation below is still the earlier verdict's. */
  reevaluating?: boolean;
  /** The verdict this one replaced, when the turn was re-evaluated. */
  previous?: PreviousVerdict | null;
}) {
  const verdict = verdictOf(data.summary);
  const score = data.scores.find((item) => item.metric_name === 'manifest_eval');
  const oldReason = splitBilingual(data.turn.label_reason ?? '');
  const explanation = score?.explanation;
  const prefix = [data.turn.label, score?.label]
    .filter(Boolean)
    .map((label) => `${label} — `)
    .find((label) => explanation?.startsWith(label));
  const legacy = splitBilingual((prefix ? explanation?.slice(prefix.length) : explanation) ?? '');
  const en = verdict?.reasonEn || legacy.en || oldReason.en;
  const ar = verdict?.reasonAr || legacy.ar || oldReason.ar;
  const confidence = verdict?.confidence ?? numberOf(recordOf(score?.meta)?.confidence);
  const label = labelFor(verdict?.label ?? data.turn.label, data.specs);
  const { tone } = verdictTone(label.specTone);
  return (
    <Card compact tone={label.tone} series={label.series} data-live-block="why" data-live-card="why">
      <div className={turnStyles.verdictLine}>
        <StatusMark
          data-live-block="diagnosis-label"
          label={reevaluating ? 'Re-evaluating' : label.label}
          data-series={reevaluating ? undefined : label.series}
          tone={reevaluating ? 'info' : tone}
          shape={
            reevaluating
              ? 'orbit'
              : tone === 'success'
                ? 'check'
                : tone === 'danger'
                  ? 'cross'
                  : tone === 'warning'
                    ? 'full'
                    : 'ring'
          }
        />
        <div className={turnStyles.verdictContent}>
          {en || ar ? (
            <Bilingual en={en || null} ar={ar || null} />
          ) : (
            <EmptyState compact title="No diagnosis explanation available for this turn" />
          )}
          {verdict?.basis || confidence !== null || (previous && !reevaluating) ? (
            <div className={turnStyles.verdictMeta}>
              {previous && !reevaluating ? (
                <span data-live-block="previous-verdict">
                  Previous verdict: {previous.label}
                  {previous.at ? `, ${liveTime(previous.at)}` : ''}
                </span>
              ) : null}
              {verdict?.basis ? <span>Decided by {basisWords[verdict.basis]}</span> : null}
              {confidence !== null ? (
                <span>
                  Confidence <span className={turnStyles.number}>{formatPercentValue(confidence, 1)}</span>
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function DiagnosisSteps({ data }: { data: LiveTurnDetail }) {
  const steps = verdictOf(data.summary)?.steps ?? [];
  return (
    <Card
      flush
      className={turnStyles.proseTable}
      data-live-block="diagnosis-steps"
      data-live-card="diagnosis-steps"
      header={
        <div className={styles.stepsHeading}>
          <Text as="h2" variant="lg" weight={600}>
            How we got here
          </Text>
          <Text variant="sm" tone="muted">
            Each check the evaluator ran, in order.
          </Text>
        </div>
      }
    >
      {steps.length ? (
        <DataTable
          aria-label="How we got here"
          fit="declared"
          rows={steps.map((step, index) => ({ ...step, index }))}
          rowKey={(step) => step.index}
          columns={[
            {
              id: 'number',
              header: '#',
              type: 'number',
              align: 'start',
              width: 56,
              minWidth: 56,
              maxWidth: 56,
              resizable: false,
              cell: (step) => step.index + 1,
            },
            {
              id: 'check',
              header: 'Check',
              width: 136,
              resizable: false,
              cell: (step) =>
                step.kind ? (
                  <Tag className={styles.checkKind}>{kindWords[step.kind] ?? sentenceCase(step.kind)}</Tag>
                ) : null,
            },
            {
              id: 'finding',
              header: 'What it found',
              flex: true,
              resizable: false,
              cell: (step) => {
                const evidence = stepEvidence(step.source, step.kind);
                return (
                  <div className={styles.finding}>
                    <Bilingual en={step.textEn} ar={step.textAr} />
                    {evidence ? (
                      <Text as="p" variant="sm" tone="muted">
                        {evidence}
                      </Text>
                    ) : null}
                  </div>
                );
              },
            },
          ]}
          density="compact"
          densityLocked
          variant="embedded"
          responsive="scroll"
          stickyHeader={false}
        />
      ) : (
        <EmptyState compact title="No diagnosis steps recorded for this turn" />
      )}
    </Card>
  );
}

export function DiagnosisRules({ summary }: { summary: Record<string, unknown> }) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(false);
  const rules = rulesAppliedOf(summary)
    .filter((rule) => rule.id || rule.titleEn || rule.titleAr || rule.verdictEn || rule.verdictAr)
    .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? '', 'en', { numeric: true }));
  const cited = rules.filter((rule) => rule.role !== 'told_to_judges');
  if (!rules.length)
    return (
      <Card data-live-block="rules" data-live-card="rules">
        <div className={styles.rulesHeading}>
          <Text as="h2" variant="lg" weight={600}>
            Insightor rules behind this verdict
          </Text>
          <Text variant="sm" tone="muted">
            No rules were recorded for this turn
          </Text>
        </div>
      </Card>
    );
  return (
    <Card flush className={turnStyles.proseTable} data-live-block="rules" data-live-card="rules">
      <Disclosure
        className={styles.rulesDisclosure}
        open={open}
        onOpenChange={setOpen}
        aside={
          open ? (
            <Button onPress={() => setShowAll((value) => !value)}>
              {showAll ? 'Show cited only' : `Show all ${rules.length}`}
            </Button>
          ) : undefined
        }
        title={
          <span className={styles.rulesHeading}>
            <span>Insightor rules behind this verdict</span>
            <span className={styles.rulesSummary}>
              <span>
                {cited.length
                  ? `${cited.length} of ${rules.length} rules were cited:`
                  : `None of the ${rules.length} rules was cited`}
              </span>
              {cited.map((rule, index) =>
                rule.id ? (
                  <Tag key={index} kind="data">
                    {rule.id}
                  </Tag>
                ) : null,
              )}
            </span>
          </span>
        }
      >
        <RulesApplied rules={showAll ? rules : cited} />
      </Disclosure>
    </Card>
  );
}
