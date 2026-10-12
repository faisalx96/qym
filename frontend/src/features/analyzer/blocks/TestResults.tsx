import { Badge, EmptyState, Tag, Text } from '@/ui';
import type { AnalysisResultPayload } from '@/api/analysis';
import { rootCauseIssues } from '../model/rootCause';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import s from './blocks.module.css';

function ResultCard({ r, fields, ws }: { r: AnalysisResultPayload; fields: string[]; ws: RunWorkspace }) {
  const issues = r.error ? [] : rootCauseIssues(r);
  const row = ws.rowById.get(r.item_id);
  const context = row
    ? JSON.stringify({ input: row.input_full ?? row.input, expected: row.expected_full ?? row.expected, output: row.output_full ?? row.output }, null, 2)
    : '';
  const confidence = issues[0]?.confidence ?? r.confidence ?? null;
  return (
    <article className={s.result} aria-label={`Test result for item ${r.item_id}`}>
      <header className={s.resultHead}>
        <Text variant="md" weight={600} as="span">
          {r.item_id} · <span className={s.mono}>{r.metric_name}</span>
        </Text>
        {r.error ? (
          <Badge tone="danger">{r.error_code || 'Error'}</Badge>
        ) : (
          <Badge tone={issues.length ? 'info' : 'warning'}>
            {issues.length && confidence != null ? `${Math.round(confidence * 100)}% confidence` : issues.length ? 'Diagnosed' : 'No diagnosis'}
          </Badge>
        )}
        {r.retry_count ? (
          <Text variant="sm" tone="muted" as="span">
            {`${r.retry_count} ${r.retry_count === 1 ? 'retry' : 'retries'}${r.retry_reason ? `: ${r.retry_reason}` : ''}`}
          </Text>
        ) : null}
      </header>
      {r.error ? (
        <Text variant="base" tone="danger" as="p" role="alert">
          {r.error}
        </Text>
      ) : null}
      {r.warning ? (
        <Text variant="base" tone="warning" as="p">
          {r.warning}
        </Text>
      ) : null}
      <ol className={s.issues}>
        {issues.map((i, idx) => (
          <li key={idx} className={s.issue}>
            <div className={s.issueTags}>
              <Tag kind="role">{i.category || 'Uncategorized'}</Tag>
              {i.subcategory ? <Tag kind="data">{i.subcategory}</Tag> : null}
              {i.confidence != null ? (
                <Text variant="sm" mono tone="muted" as="span" aria-label={`confidence ${Math.round(i.confidence * 100)} percent`}>
                  {`${Math.round(i.confidence * 100)}%`}
                </Text>
              ) : null}
            </div>
            <Text variant="base" tone="secondary" as="p" dir="auto">
              {i.finding}
            </Text>
          </li>
        ))}
      </ol>
      <div className={s.previewFoot}>
        <Text variant="sm" tone="muted" as="span">
          Fields sent:
        </Text>
        {fields.map((f) => (
          <Tag key={f} kind="data">
            {f}
          </Tag>
        ))}
      </div>
      {context ? (
        <details className={s.details}>
          <summary>Item context</summary>
          <pre className={s.messageBody} dir="auto">
            {context}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

/** Test result cards: issues with category / subcategory / finding / confidence, fields sent. */
export function TestResults({ ws }: { ws: RunWorkspace }) {
  const { test } = ws;
  if (test.testing) {
    return (
      <Text variant="base" tone="muted" as="p" role="status">
        Testing against the connection… Nothing is saved and no job is created.
      </Text>
    );
  }
  if (test.error) {
    return (
      <Text variant="base" tone="danger" as="p" role="alert">
        {test.error}
      </Text>
    );
  }
  if (!test.outcome) {
    return <EmptyState compact title="No test run yet" body="Test up to 3 items to see the diagnosis before analyzing everything." />;
  }
  const { results, fields } = test.outcome;
  return (
    <div className={s.stack}>
      {results.map((r) => (
        <ResultCard key={`${r.item_id}-${r.metric_name}`} r={r} fields={fields} ws={ws} />
      ))}
    </div>
  );
}

