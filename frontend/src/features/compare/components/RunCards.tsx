/** Run cards: identity (swatch, letter, name), status, counts, owner, dataset, runtime, experiment, model; remove and baseline controls. */
import { Link } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { Card, Disclosure, IconButton, RunStatusBadge, Tag, Text } from '@/ui';
import type { RunPayload } from '@/features/run-detail/types';
import { formatDurationMs } from '@/features/run-detail/lib/heroModel';
import { letterOf, runSeries, useCompare } from '../CompareContext';
import { runShortName } from '../lib/labels';
import { MIN_COMPARE_RUNS, passRefBase } from '../lib/refs';
import { differingContext, ownerLabel, runCounts } from '../lib/runInfo';
import { RunTag, useRunMark } from './RunTag';
import styles from './RunCards.module.css';

/** Up to this many runs a card shows the full fact list; beyond it the compact two-line card. */
const FULL_CARDS = 4;
/** Beyond this many runs the compact cards pack into narrow auto-fill columns. */
const DENSE_CARDS = 8;

export function RunCards() {
  const { model, c, slug, baseline, columns, cohorts } = useCompare();
  const sideOf = (base: string): 'A' | 'B' | null =>
    !cohorts
      ? null
      : cohorts.left.some((r) => passRefBase(r) === base)
        ? 'A'
        : cohorts.right.some((r) => passRefBase(r) === base)
          ? 'B'
          : null;
  const payloads = new Map((c.query.data?.runs ?? []).map((p) => [p.run.file_path || p.run.run_id, p]));
  const cards = model.bases
    .map((base) => {
      const idx = model.runs.findIndex((r) => r.base === base);
      const payload = payloads.get(base);
      const run = model.runs[idx];
      return payload && run
        ? { base, idx, payload, name: runShortName({ label: run.label, run: run.run }), title: run.title }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const diff = differingContext(cards.map((x) => x.payload.run));
  const live = cards.filter((x) =>
    ['RUNNING', 'PENDING', 'STOPPING'].includes(String(x.payload.run.status).toUpperCase()),
  ).length;
  const removable = !cohorts && model.bases.length > MIN_COMPARE_RUNS;
  const variant = cards.length <= FULL_CARDS ? 'full' : cards.length <= DENSE_CARDS ? 'compact' : 'dense';
  return (
    <div className={styles.wrap} data-testid="run-details">
      {live ? (
        <Text variant="sm" tone="muted">
          {live} run{live === 1 ? ' is' : 's are'} still in progress; its numbers are partial.
        </Text>
      ) : null}
      <ul className={styles.cards} data-variant={variant} aria-label="Runs in this comparison">
        {cards.map((card) => (
          <RunCard
            key={card.base}
            {...card}
            variant={variant}
            side={sideOf(card.base)}
            sideLabel={cohorts ? (sideOf(card.base) === 'A' ? cohorts.leftLabel : cohorts.rightLabel) : ''}
            slug={slug}
            isBase={baseline.base === card.base}
            removable={removable}
            onRemove={() => c.removeRun(card.base)}
            onBaseline={
              cohorts
                ? undefined
                : () =>
                    c.setView({ baseline: columns.find((col) => col.base === card.base)?.key ?? card.base })
            }
          />
        ))}
      </ul>
      {diff.length ? (
        <Disclosure
          title="What differs between the runs"
          summary={`${diff.length} setting${diff.length === 1 ? '' : 's'}`}
        >
          <div className={styles.diff}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  {cards.map(({ base, idx, name, title }) => (
                    <th scope="col" key={base}>
                      <RunTag index={idx} name={name} title={title} compact />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diff.map((d) => (
                  <tr key={`${d.group}:${d.key}`}>
                    <th scope="row">
                      <span className={styles.group}>{d.group}</span> {d.key}
                    </th>
                    {d.values.map((v, i) => (
                      <td key={i}>{v || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}

type CardData = {
  base: string;
  idx: number;
  payload: RunPayload;
  name: string;
  title: string;
};

function RunCard({
  base,
  idx,
  payload,
  name,
  title,
  variant,
  side,
  sideLabel,
  slug,
  isBase,
  removable,
  onRemove,
  onBaseline,
}: CardData & {
  variant: 'full' | 'compact' | 'dense';
  side: 'A' | 'B' | null;
  sideLabel: string;
  slug: string | undefined;
  isBase: boolean;
  removable: boolean;
  onRemove: () => void;
  onBaseline?: () => void;
}) {
  const mark = useRunMark(idx);
  const run = payload.run;
  const counts = runCounts(payload);
  const runtime = formatDurationMs(run.duration_ms);
  const owner = ownerLabel(run);
  const exp = run.experiment;
  const expSlug = run.project?.slug ?? slug;
  const status = String(run.status).toUpperCase();
  return (
    <li
      className={styles.item}
      data-testid="run-card"
      data-run={base}
      data-status={status}
      data-baseline={isBase || undefined}
      {...mark}
    >
      <Card series={runSeries(idx)} compact={variant !== 'full'} className={styles.runCard}>
        <div className={styles.stack}>
          <div className={styles.cardHead}>
            <RunTag index={idx} name={name} title={title} baseline={isBase} bare />
            {side ? (
              <Tag kind="role" title={`Side ${side}: ${sideLabel}`}>
                Side {side}
              </Tag>
            ) : null}
            <RunStatusBadge status={status} label={status} />
            {run.origin === 'official' ? (
              <Tag kind="accent" title="Run launched by an official experiment">
                Official
              </Tag>
            ) : null}
            <span className={styles.actions}>
              {onBaseline && !isBase ? (
                <IconButton
                  label={`Set ${letterOf(idx)} ${name} as the baseline`}
                  icon={<span aria-hidden>{'☆'}</span>}
                  onPress={onBaseline}
                />
              ) : null}
              {removable ? (
                <IconButton label={`Remove ${name} from the comparison`} icon="close" onPress={onRemove} />
              ) : null}
            </span>
          </div>
          {variant === 'full' ? (
            <>
              <dl className={styles.strip}>
                <Stat label="Items" value={counts.items} />
                <Stat label="Completed" value={counts.completed} />
                <Stat label="Errors" value={counts.errors} danger={counts.errors > 0} />
              </dl>
              <dl className={styles.facts}>
                <Fact label="Model">{run.model_name}</Fact>
                <Fact label="Owner">{owner}</Fact>
                <Fact label="Dataset">
                  {run.dataset_name}
                  {run.dataset_version ? ` v${run.dataset_version}` : ''}
                </Fact>
                <Fact label="Runtime">{runtime === '—' ? '' : runtime}</Fact>
                <Fact label="Experiment">
                  {exp && expSlug ? (
                    <Link to={projectPath(expSlug, `experiments/${exp.id}`)}>{exp.name || exp.id}</Link>
                  ) : null}
                </Fact>
              </dl>
            </>
          ) : (
            <Text variant="sm" tone="muted" className={styles.line}>
              {[run.model_name, owner, `${counts.completed} ok`, `${counts.errors} err`]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </div>
      </Card>
    </li>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={styles.stat} data-danger={danger || undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === '' || children === false) return null;
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
