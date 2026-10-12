/** Root-cause categories over the filtered items, per run (brief 05 J5); solutions sit under each category (the Sankey's right-hand side). */
import { useMemo } from 'react';
import { Select, Tag, Text } from '@/ui';
import { platformUrl } from '@/lib/runtime';
import { hasAnyRootCause, rootCauseSummary } from '../../lib/breakdown';
import { letterOf, useCompare } from '../../CompareContext';
import { RunDot } from '../common';
import { ScrollRegion } from '../ScrollRegion';
import styles from './Panel.module.css';

/** Links to each run's auto-analysis workspace. */
export function AnalyzeLinks() {
  const { model, slug } = useCompare();
  return (
    <div className={styles.stack}>
      <Text variant="sm" tone="muted">
        Analyze a run:
      </Text>
      <ul className={styles.subList} aria-label="Analyze a run">
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
        <ScrollRegion className={styles.scroll} label="Root cause table">
          <table className={styles.table}>
            <caption className={styles.caption}>Issues per root-cause category; pressing a category filters the items.</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                {columns.map((col) => (
                  <th scope="col" key={col.key} title={col.title}>
                    <RunDot index={col.runIdxs[0] ?? 0} /> {letterOf(col.runIdxs[0] ?? 0)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cats.map((cat) => (
                <tr key={cat.category} data-active={(f.rootCause?.includes(cat.category) ?? false) || undefined}>
                  <th scope="row">
                    <button type="button" className={styles.rowButton} aria-pressed={!!f.rootCause?.includes(cat.category)} onClick={() => toggle(cat.category)}>
                      {cat.category} <span className={styles.count}>{cat.count}</span>
                    </button>
                    {cat.subcauses.length ? (
                      <span className={styles.subList}>
                        {cat.subcauses.map(([name, n]) => (
                          <Tag key={name} kind="data" title={name}>
                            {name} {n}
                          </Tag>
                        ))}
                      </span>
                    ) : null}
                    {cat.solutions.length ? (
                      <span className={styles.subList} aria-label={`Solutions for ${cat.category}`}>
                        {cat.solutions.map(([name, n]) => (
                          <Tag key={name} kind="data" tone="info" title={`Solution: ${name}`}>
                            {'→'} {name} {n}
                          </Tag>
                        ))}
                      </span>
                    ) : null}
                  </th>
                  {columns.map((col, i) => (
                    <td key={col.key}>
                      <span className={styles.value}>{cat.counts[i] ?? 0}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      <AnalyzeLinks />
    </div>
  );
}
