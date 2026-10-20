import { Fragment, useMemo, type ReactNode } from 'react';
import { Badge, Button, Card, KeyValueGrid, Text } from '@/ui';
import { plural } from '../../lib/format';
import { Callout } from '../components/Callout';
import { VersionsSummary } from '../entry/VersionsBlock';
import { ProblemList } from '../components/ProblemList';
import { useGoToSection } from '../components/goToSection';
import {
  axesOf,
  buildSpec,
  datasetChanged,
  datasetValue,
  baseLabel,
  pointerToFieldName,
  runEstimate,
  runNamePreview,
  type LaunchWarning,
  type Priority,
  validationItem,
} from '../model';
import {
  CEILING_POINTER,
  CEILING_WARNING_ACTION,
  CEILING_WARNING_TITLE,
  LATENCY_REVIEW_LABEL,
  LATENCY_REVIEW_VALUE,
  TOKEN_WARNING_TITLE,
} from '../copy';
import { SECTION_IDS, SECTION_TITLES, useLaunch, type SectionId } from '../LaunchContext';
import { LaunchActions } from './LaunchActions';
import styles from './review.module.css';

function priorityText(p: Priority | ''): string {
  return p || 'Environment default';
}

const TOKEN_KEY = 'QYM_DATASET_READ_TOKEN';

/** The warning text with the variable name in mono. */
function withMono(message: string): ReactNode {
  return message.split(TOKEN_KEY).map((part, i, all) => (
    <Fragment key={i}>
      {part}
      {i < all.length - 1 ? (
        <Text variant="base" as="span" mono>
          {TOKEN_KEY}
        </Text>
      ) : null}
    </Fragment>
  ));
}

/** Launch-level dry-run warnings: never change the badge and never disable Launch (B5-41). */
function LaunchWarnings({ warnings }: { warnings: readonly LaunchWarning[] }) {
  const { ctx, focusIssue } = useLaunch();
  return (
    <>
      {warnings.map((w, i) =>
        w.code === 'vllm_ceiling_unset' ? (
          <Callout key={`${w.code}-${i}`} tone="warning" title={CEILING_WARNING_TITLE}>
            <span>{w.message}</span>
            <div>
              <Button
                size="sm"
                variant="neutral"
                onPress={() =>
                  // Opens the step, the section and the collapsed group that holds the setting.
                  focusIssue(validationItem(CEILING_POINTER, w.message, ctx, { source: 'local' }))
                }
              >
                {CEILING_WARNING_ACTION}
              </Button>
            </div>
          </Callout>
        ) : w.code === 'dataset_token_not_declared' ? (
          <Callout key={`${w.code}-${i}`} tone="warning" title={TOKEN_WARNING_TITLE}>
            <span>{withMono(w.message)}</span>
          </Callout>
        ) : null,
      )}
    </>
  );
}

/** "Changes by step": real counts per section with an Edit link each. */
function ChangesByStep() {
  const { doc, ctx, sectionSummary, focusField, revealStep } = useLaunch();
  const goTo = useGoToSection();
  const sweepAxes = useMemo(
    () => axesOf(buildSpec(doc, ctx.evaluatorPanel)).axes.length,
    [doc, ctx.evaluatorPanel],
  );
  const rows: Array<{ key: string; label: string; onEdit: () => void }> = [];
  if (datasetChanged(doc)) {
    rows.push({
      key: 'dataset',
      label: 'Dataset changed',
      onEdit: () => {
        revealStep('where');
        focusField(pointerToFieldName('/evaluator/dataset'));
      },
    });
  }
  for (const id of SECTION_IDS as readonly SectionId[]) {
    if (id === 'raw') continue;
    const changes = id === 'sweeps' ? sweepAxes : sectionSummary(id).changes;
    if (!changes) continue;
    const label =
      id === 'sweeps'
        ? `${SECTION_TITLES[id]}: ${plural(changes, 'swept setting')}`
        : `${SECTION_TITLES[id]}: ${plural(changes, 'change')}`;
    rows.push({ key: id, label, onEdit: () => goTo(id) });
  }
  return (
    <section aria-labelledby="launch-changes-title" className={styles.pane}>
      <Text variant="md" weight={600} as="h4" id="launch-changes-title">
        Changes by step
      </Text>
      {rows.length ? (
        <ul className={styles.changes}>
          {rows.map((r) => (
            <li key={r.key} className={styles.change}>
              <span>{r.label}</span>
              <Button size="sm" variant="ghost" onPress={r.onEdit} aria-label={`Edit: ${r.label}`}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <Text variant="base" tone="muted">
          Nothing changed on top of the starting point.
        </Text>
      )}
    </section>
  );
}

/** The always-visible review: summary, live run count, changes by step, problems, launch actions. */
export function ReviewPane({
  onCancel,
  hideActions,
  rawAction = true,
}: {
  onCancel: () => void;
  hideActions?: boolean;
  /** Offer the "Raw JSON" action (off on the review step, which has its own Show raw JSON button). */
  rawAction?: boolean;
}) {
  const { doc, ctx, review, preview, selectedEnvs, readOnly } = useLaunch();
  const { count } = review;
  const envCount = doc.environmentIds.length;
  const estimate = useMemo(
    () => runEstimate(buildSpec(doc, ctx.evaluatorPanel), envCount, count.cap),
    [doc, ctx.evaluatorPanel, envCount, count.cap],
  );
  const names = runNamePreview(preview.data?.jobs);
  const ready = review.items.length === 0 && !preview.loading && !preview.error && preview.data != null;
  return (
    <Card as="aside" aria-label="Review">
      <div className={styles.pane}>
        <div className={styles.head}>
          <Text variant="lg" as="h3">
            Review
          </Text>
          {review.items.length ? (
            <Badge tone="danger">{plural(review.items.length, 'problem')}</Badge>
          ) : ready ? (
            <Badge tone="success">Ready</Badge>
          ) : (
            <Badge tone="neutral">{preview.loading ? 'Checking' : 'Review'}</Badge>
          )}
        </div>
        <KeyValueGrid
          columns={1}
          dense
          aria-label="Summary"
          items={[
            { key: 'env', label: 'Environments', value: selectedEnvs.map((e) => e.name).join(', ') || '—' },
            { key: 'ds', label: 'Dataset', value: datasetValue(doc) || '—', mono: true },
            {
              key: 'base',
              label: 'Start from',
              value: envCount
                ? baseLabel(doc, (id) => selectedEnvs.find((e) => e.id === id)?.name ?? id)
                : '—',
            },
            { key: 'prio', label: 'Priority', value: priorityText(doc.priority) },
            ...(doc.latencySensitive
              ? [{ key: 'latency', label: LATENCY_REVIEW_LABEL, value: LATENCY_REVIEW_VALUE }]
              : []),
            ...(selectedEnvs.length
              ? [{ key: 'versions', label: 'Versions', value: <VersionsSummary /> }]
              : []),
          ]}
        />
        <div>
          <div className={styles.runs} aria-live="polite">
            <span className={styles.runsValue} data-over={count.over}>
              {count.runs}
            </span>
            <Text variant="md" weight={600}>
              {count.runs === 1 ? 'run' : 'runs'} to launch
            </Text>
          </div>
          {estimate.combos > 1 || envCount > 1 ? <p className={styles.math}>{estimate.math}</p> : null}
        </div>
        {count.over ? (
          <Callout tone="error" live title="Over the run limit">
            This would create {count.runs} runs; the limit is {count.cap} per launch. Remove sweep values or
            environments.
          </Callout>
        ) : null}
        {preview.data?.preemption_warning ? (
          <Callout tone="warning">{preview.data.preemption_warning}</Callout>
        ) : null}
        <LaunchWarnings warnings={preview.data?.warnings ?? []} />
        <ChangesByStep />
        <section aria-labelledby="launch-validation-title" className={styles.pane}>
          <Text variant="md" weight={600} as="h4" id="launch-validation-title">
            {review.items.length ? `${plural(review.items.length, 'problem')} to fix` : 'Validation'}
          </Text>
          {review.items.length ? (
            <ProblemList items={review.items} label="Problems to fix" />
          ) : (
            <Text variant="base" className={styles.ok} role="status">
              {review.status || 'Nothing to check yet'}
            </Text>
          )}
        </section>
        {names.names.length > 1 ? (
          <details>
            <summary>Run names</summary>
            <ol className={styles.names}>
              {names.names.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ol>
            {names.more ? (
              <Text variant="sm" tone="muted">
                and {names.more} more
              </Text>
            ) : null}
          </details>
        ) : null}
        {readOnly ? <Callout tone="warning">Archived project: read only.</Callout> : null}
        {hideActions ? null : <LaunchActions onCancel={onCancel} hideRaw={!rawAction} />}
      </div>
    </Card>
  );
}
