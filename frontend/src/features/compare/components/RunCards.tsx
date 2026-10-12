/** Run summary cards: status, origin, counts, owner, dataset version, runtime, experiment, model, and what differs between the runs. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { projectPath } from '@/app/routes';
import { Button, Icon, RunStatusBadge, Tag, Text } from '@/ui';
import { formatDurationMs } from '@/features/run-detail/lib/heroModel';
import { letterOf, useCompare } from '../CompareContext';
import { differingContext, ownerLabel, runCounts } from '../lib/runInfo';
import { RunDot } from './common';
import styles from './RunCards.module.css';

export function RunCards() {
  const { model, c, slug } = useCompare();
  const [open, setOpen] = useState(false);
  const payloads = new Map((c.query.data?.runs ?? []).map((p) => [p.run.file_path || p.run.run_id, p]));
  const cards = model.bases
    .map((base) => {
      const idx = model.runs.findIndex((r) => r.base === base);
      const payload = payloads.get(base);
      const run = model.runs[idx];
      return payload && run ? { base, idx, payload, label: run.label.replace(/ · pass \d+$/, '') } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const diff = differingContext(cards.map((x) => x.payload.run));
  const live = cards.filter((x) =>
    ['RUNNING', 'PENDING', 'STOPPING'].includes(String(x.payload.run.status).toUpperCase()),
  ).length;
  return (
    <section className={styles.wrap} aria-label="Run details">
      <div className={styles.head}>
        <Button
          size="sm"
          variant="neutral"
          aria-expanded={open}
          aria-controls="compare-run-cards"
          icon={<Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />}
          onPress={() => setOpen(!open)}
        >
          Run details
        </Button>
        {live ? (
          <Text variant="sm" tone="muted">
            {live} run{live === 1 ? ' is' : 's are'} still in progress; its numbers are partial.
          </Text>
        ) : null}
      </div>
      {open ? (
        <div id="compare-run-cards" className={styles.body}>
          <ul className={styles.cards}>
            {cards.map(({ base, idx, payload, label }) => {
              const run = payload.run;
              const counts = runCounts(payload);
              const runtime = formatDurationMs(run.duration_ms);
              const owner = ownerLabel(run);
              const exp = run.experiment;
              const expSlug = run.project?.slug ?? slug;
              return (
                <li
                  key={base}
                  className={styles.card}
                  data-testid="run-card"
                  data-run={base}
                  data-status={String(run.status).toUpperCase()}
                >
                  <div className={styles.cardHead}>
                    <RunDot index={idx} />
                    <span className={styles.letter}>{letterOf(idx)}</span>
                    <span className={styles.name} title={run.run_name || base}>
                      {label}
                    </span>
                    <RunStatusBadge
                      status={String(run.status).toUpperCase()}
                      label={String(run.status).toUpperCase()}
                    />
                    {run.origin === 'official' ? (
                      <Tag kind="accent" title="Run launched by an official experiment">
                        Official
                      </Tag>
                    ) : null}
                  </div>
                  <dl className={styles.facts}>
                    <Fact label="Items">
                      {counts.items} · {counts.completed} completed · {counts.errors} error
                      {counts.errors === 1 ? '' : 's'}
                    </Fact>
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
                </li>
              );
            })}
          </ul>
          {diff.length ? (
            <div className={styles.diff}>
              <Text variant="sm" weight={650} tone="muted">
                What differs between the runs
              </Text>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Setting</th>
                    {cards.map(({ base, idx }) => (
                      <th scope="col" key={base}>
                        {letterOf(idx)}
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
          ) : null}
        </div>
      ) : null}
    </section>
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
