/** Run cards (round 8, legacy parity): one box per run, the same four-up card at any run count: identity, health, configuration. */
import { Button, Icon, IconButton, Popover, RunStatusBadge, StatStrip, Tag, Text, UserName } from '@/ui';
import type { RunPayload } from '@/features/run-detail/types';
import { formatDurationMs } from '@/features/run-detail/lib/heroModel';
import { datasetsTitle } from '@/features/run-detail/lib/heroModel';
import { datasetVersionLabel, formatDateParts } from '@/lib/format';
import { runSeries, useCompare } from '../CompareContext';
import { runShortName } from '../lib/labels';
import { MIN_COMPARE_RUNS } from '../lib/refs';
import { runDatasetCount } from '../lib/datasetSets';
import { differingContext, ownerLabel, runCounts } from '../lib/runInfo';
import { RunCardActions } from './RunCardActions';
import { RunTag, useRunMark } from './RunTag';
import styles from './RunCards.module.css';

/** The card whose remove button takes the focus after a removal; kept in sessionStorage because the body remounts while the new set loads. */
const FOCUS_NEXT = 'compareFocusNext';

function takeFocusNext(base: string): boolean {
  try {
    if (sessionStorage.getItem(FOCUS_NEXT) !== base) return false;
    sessionStorage.removeItem(FOCUS_NEXT);
    return true;
  } catch {
    return false;
  }
}

export function RunCards() {
  const { model, c, baseline, cohorts } = useCompare();
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
  const live = cards.filter((x) =>
    ['RUNNING', 'PENDING', 'STOPPING'].includes(String(x.payload.run.status).toUpperCase()),
  ).length;
  const removable = !cohorts && model.bases.length > MIN_COMPARE_RUNS;
  // After a removal the focus moves to the next card's remove button (C-run-6); the body remounts while the
  // new set loads, so the button takes the focus when it registers.
  const remove = (base: string, at: number) => {
    const next = cards[at + 1] ?? cards[at - 1];
    try {
      if (next) sessionStorage.setItem(FOCUS_NEXT, next.base);
      else sessionStorage.removeItem(FOCUS_NEXT);
    } catch {
      /* storage blocked: focus stays where the browser puts it */
    }
    c.removeRun(base);
  };
  return (
    <div className={styles.wrap} data-testid="run-details">
      {live ? (
        <Text variant="sm" tone="muted">
          {live} run{live === 1 ? ' is' : 's are'} still in progress; its numbers are partial.
        </Text>
      ) : null}
      <ul className={styles.cards} aria-label="Runs in this comparison" data-part="run-grid">
        {cards.map((card, at) => (
          <RunCard
            key={card.base}
            {...card}
            isBase={!model.unpaired && baseline.base === card.base}
            removable={removable}
            onRemove={() => remove(card.base, at)}
            registerRemove={(el) => {
              if (el && takeFocusNext(card.base)) {
                el.focus();
              }
            }}
          />
        ))}
      </ul>
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
  isBase,
  removable,
  onRemove,
  registerRemove,
}: CardData & {
  isBase: boolean;
  removable: boolean;
  onRemove: () => void;
  registerRemove: (el: HTMLButtonElement | null) => void;
}) {
  const mark = useRunMark(idx);
  const run = payload.run;
  const counts = runCounts(payload);
  const runtime = formatDurationMs(run.duration_ms);
  const status = String(run.status).toUpperCase();
  const started = formatDateParts(run.started_at ?? run.created_at);
  const datasets = runDatasetCount(run);
  const facts: Array<[string, string, boolean]> = [
    ['Task', run.task_name ?? '', true],
    ['Model', run.model_name ?? '', true],
    ['Owner', ownerLabel(run), false],
    [
      datasets > 1 ? 'Datasets' : 'Dataset',
      datasets > 1
        ? `${datasets} datasets`
        : [run.dataset_name ?? '', datasetVersionLabel(run.dataset_version)].filter(Boolean).join(' '),
      true,
    ],
    ['Started', started.date === '—' ? '' : started.full, false],
    ['Runtime', runtime === '—' ? '' : runtime, true],
  ];
  return (
    <li
      className={styles.item}
      data-testid="run-card"
      data-part="run-card"
      data-run={base}
      data-status={status}
      data-baseline={isBase || undefined}
      style={{ '--run': `var(--chart-${runSeries(idx)})` } as React.CSSProperties}
      {...mark}
    >
      <article className={styles.card}>
        <div className={styles.top}>
          <RunTag index={idx} name={name} title={title} baseline={isBase} bare />
          <span className={styles.badges}>
            <span data-part="run-status">
              <RunStatusBadge status={status} label={status.charAt(0) + status.slice(1).toLowerCase()} />
            </span>
            {isBase ? null : <RunCardActions run={run} name={name} />}
          </span>
          {removable ? (
            <IconButton
              ref={registerRemove}
              label={`Remove ${name} from the comparison`}
              icon="close"
              tone="reject"
              className={styles.remove}
              data-part="run-remove"
              onPress={onRemove}
            />
          ) : null}
        </div>
        {counts.executions ? (
          <div>
            <div data-part="run-stat-strip">
              <StatStrip
                variant="mini"
                aria-label="Run counts"
                items={[
                  {
                    key: 'executions',
                    label: 'Executions',
                    value: counts.executions.total,
                    icon: <Icon name="list" size={12} />,
                  },
                  {
                    key: 'succeeded',
                    label: 'Succeeded',
                    value: counts.executions.succeeded,
                    icon: <Icon name="check" size={12} />,
                    tone: 'success',
                  },
                  {
                    key: 'errors',
                    label: 'Errors',
                    value: counts.executions.errors,
                    icon: <Icon name="warning" size={12} />,
                    tone: counts.executions.errors > 0 ? 'danger' : undefined,
                  },
                ]}
              />
            </div>
            <p className={styles.passes} data-part="run-passes">
              {counts.items} items × {counts.executions.passes} passes
            </p>
          </div>
        ) : (
          <div data-part="run-stat-strip">
            <StatStrip
              variant="mini"
              aria-label="Run counts"
              items={[
                { key: 'items', label: 'Items', value: counts.items, icon: <Icon name="list" size={12} /> },
                {
                  key: 'completed',
                  label: 'Completed',
                  value: counts.completed,
                  icon: <Icon name="check" size={12} />,
                  tone: 'success',
                },
                {
                  key: 'errors',
                  label: 'Errors',
                  value: counts.errors,
                  icon: <Icon name="warning" size={12} />,
                  tone: counts.errors > 0 ? 'danger' : undefined,
                },
              ]}
            />
          </div>
        )}
        <dl className={styles.facts} data-part="run-meta">
          {facts.map(([k, v, mono]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd
                className={mono ? styles.mono : undefined}
                title={k === 'Datasets' ? datasetsTitle(run.datasets ?? []) : undefined}
              >
                {k === 'Owner' && v ? (
                  <UserName id={run.owner?.id} name={v} email={run.owner?.email} />
                ) : (
                  v || '—'
                )}
              </dd>
            </div>
          ))}
        </dl>
      </article>
    </li>
  );
}

/** "What differs between the runs": the settings (git, config, versioning, datasets) that are not the same on every run. In the Runs head, so the cards keep their height. */
export function RunsDiff() {
  const { model, c } = useCompare();
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
  if (!diff.length) return null;
  return (
    <Popover
      label="What differs between the runs"
      placement="bottom end"
      trigger={
        <Button size="sm" variant="neutral" data-part="runs-diff-btn">
          What differs between the runs{' '}
          <Tag kind="count">
            {diff.length} setting{diff.length === 1 ? '' : 's'}
          </Tag>
        </Button>
      }
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
    </Popover>
  );
}
