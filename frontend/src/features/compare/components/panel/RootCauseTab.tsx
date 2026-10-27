/** Root-cause categories over the filtered items, per run (brief 05 J5); solutions sit under each category (the Sankey's right-hand side). */
import { useMemo } from 'react';
import { Select, Text } from '@/ui';
import { platformUrl } from '@/lib/runtime';
import { hasAnyRootCause, rootCauseSummary } from '../../lib/breakdown';
import { letterOf, useCompare } from '../../CompareContext';
import { columnName } from '../../lib/columnName';
import { RunDot } from '../common';
import { RunTag } from '../RunTag';
import cardStyles from './Errors.module.css';
import styles from './Panel.module.css';

/** Links to each run's auto-analysis workspace. */
export function AnalyzeLinks() {
  const { model, slug } = useCompare();
  return (
    <div className={`${styles.stack} ${styles.analyzeLinks}`}>
      <Text variant="sm" tone="muted">
        Analyze a run:
      </Text>
      <ul className={styles.analyzeList} aria-label="Analyze a run">
        {model.runs.map((run, i) => {
          const project = slug ?? run.run.project?.slug;
          const id = encodeURIComponent(run.base);
          const href = project
            ? `/projects/${encodeURIComponent(project)}/analysis?run=${id}${run.pass ? `&pass=${run.pass}` : ''}`
            : `/run/${run.base.split('/').map(encodeURIComponent).join('/')}/analyzer`;
          return (
            <li key={run.ref}>
              <a href={platformUrl(href)} title={`Analyze ${run.title}`}>
                <RunDot index={i} /> {letterOf(i)} · {run.label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function RootCauseTab() {
  const { model, columns, items, c } = useCompare();
  const f = c.view.filters;
  const ids = useMemo(() => new Set(items.map((i) => i.itemId)), [items]);
  const metric = f.rootCauseMetric;
  const cats = useMemo(() => rootCauseSummary(model, columns, ids, metric), [model, columns, ids, metric]);
  const any = useMemo(() => hasAnyRootCause(model, ids), [model, ids]);
  const toggle = (category: string) => {
    const same = f.rootCause && f.rootCause.length === 1 && f.rootCause[0] === category;
    c.setView({ filters: { ...f, rootCause: same ? null : [category] } });
  };
  if (!any)
    return (
      <div className={styles.stack}>
        <Text variant="sm" tone="muted">
          No root-cause analyses on the filtered items. Run the analyzer on a run to add them.
        </Text>
        <AnalyzeLinks />
      </div>
    );
  return (
    <div className={styles.stack}>
      {model.metrics.length > 1 ? (
        <Select
          label="Metric"
          value={metric}
          onChange={(k) => k && c.setView({ filters: { ...f, rootCauseMetric: String(k) } })}
          items={[{ key: 'all', label: 'All metrics' }, ...model.metrics.map((m) => ({ key: m, label: m }))]}
          width={190}
        />
      ) : null}
      {cats.length === 0 ? (
        <Text variant="sm" tone="muted">
          No root causes for this metric.
        </Text>
      ) : (
        <ul className={cardStyles.grid} aria-label="Root causes" data-part="root-cause-cards">
          {cats.map((cat) => {
            const on = !!f.rootCause?.includes(cat.category);
            return (
              <li key={cat.category} className={cardStyles.item}>
                <div
                  className={cardStyles.card}
                  data-kind="metric"
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  data-part="root-cause-card"
                  onClick={() => toggle(cat.category)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(cat.category);
                    }
                  }}
                >
                  <div className={cardStyles.top}>
                    <b>{cat.category}</b>
                    <span className={cardStyles.count}>
                      {cat.count} <i>{cat.count === 1 ? 'issue' : 'issues'}</i>
                    </span>
                  </div>
                  {cat.subcauses.map(([name, n]) => (
                    <p key={name} className={cardStyles.detail}>
                      {name} · {n}
                    </p>
                  ))}
                  {cat.solutions.length ? (
                    <p className={cardStyles.detail} aria-label={`Solutions for ${cat.category}`}>
                      {cat.solutions.map(([name, n]) => `→ ${name} ${n}`).join(' · ')}
                    </p>
                  ) : null}
                  <table className={cardStyles.table} aria-label="Issues per run">
                    <tbody>
                      {columns.map((col, i) => (
                        <tr key={col.key} className={cardStyles.run} data-part="root-cause-run">
                          <td>
                            <RunTag
                              index={col.runIdxs[0] ?? 0}
                              name={columnName(model, col)}
                              title={col.title}
                              bare
                            />
                          </td>
                          <td className={cardStyles.num}>{cat.counts[i] ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AnalyzeLinks />
    </div>
  );
}
