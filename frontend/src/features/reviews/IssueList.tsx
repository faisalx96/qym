/** Root-cause issues (AI vs Human columns) and the inline human-diagnosis edit form. */
import { useState } from 'react';
import type { RootCauseIssue } from '@/api/reviews';
import { textDirAttrs } from '@/lib/text';
import { Button, IconButton, Tag, Text, TextField, Textarea } from '@/ui';
import styles from './IssueList.module.css';

export function IssueList({ issues, tone }: { issues: RootCauseIssue[]; tone: 'ai' | 'human' }) {
  if (!issues.length) {
    return (
      <Text variant="base" tone="muted" data-empty>
        {tone === 'ai' ? 'No AI diagnosis' : 'No human diagnosis'}
      </Text>
    );
  }
  return (
    <ol className={styles.list} data-tone={tone}>
      {issues.map((i, n) => (
        <li key={i.issue_id ?? n} className={styles.issue}>
          <div className={styles.issueHead}>
            <span className={styles.issueNum}>Issue {n + 1}</span>
            {typeof i.confidence === 'number' ? <Tag kind="count">{Math.round(i.confidence * 100)}%</Tag> : null}
          </div>
          <Text variant="md" weight={650} dir="auto">
            {i.category}
          </Text>
          {i.subcategory ? (
            <Text variant="base" weight={600} tone="secondary" dir="auto">
              {i.subcategory}
            </Text>
          ) : null}
          {i.finding ? (
            <p className={styles.finding} {...textDirAttrs(i.finding)}>
              {i.finding}
            </p>
          ) : null}
          {i.category_reason ? (
            <details className={styles.why}>
              <summary>Why this category</summary>
              <p {...textDirAttrs(i.category_reason)}>{i.category_reason}</p>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function IssueEditForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: RootCauseIssue[];
  saving: boolean;
  onSave: (issues: RootCauseIssue[]) => void;
  onCancel: () => void;
}) {
  const [issues, setIssues] = useState<RootCauseIssue[]>(initial.length ? initial.map((i) => ({ ...i })) : [{ category: '', subcategory: '', finding: '' }]);
  const [touched, setTouched] = useState(false);
  const patch = (n: number, p: Partial<RootCauseIssue>) => setIssues((list) => list.map((x, i) => (i === n ? { ...x, ...p } : x)));
  const invalid = issues.some((i) => !i.category.trim());
  return (
    <form
      className={styles.form}
      data-edit-form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!invalid) onSave(issues.map((i) => ({ ...i, category: i.category.trim(), subcategory: (i.subcategory ?? '').trim(), finding: (i.finding ?? '').trim() })));
      }}
    >
      {issues.map((i, n) => (
        <fieldset key={n} className={styles.fieldset}>
          <legend>Issue {n + 1}</legend>
          <div className={styles.fieldRow}>
            <TextField label="Category" value={i.category} onChange={(v) => patch(n, { category: v })} isRequired autoFocus={n === 0} errorMessage={touched && !i.category.trim() ? 'Category is required.' : undefined} />
            <TextField label="Subcategory" value={i.subcategory ?? ''} onChange={(v) => patch(n, { subcategory: v })} />
            {issues.length > 1 ? <IconButton label={`Remove issue ${n + 1}`} icon="trash" tone="danger" onPress={() => setIssues((l) => l.filter((_, k) => k !== n))} /> : null}
          </div>
          <Textarea label="Finding" value={i.finding ?? ''} onChange={(v) => patch(n, { finding: v })} rows={2} />
        </fieldset>
      ))}
      <div className={styles.formActions}>
        <Button variant="ghost" size="sm" onPress={() => setIssues((l) => [...l, { category: '', subcategory: '', finding: '' }])}>
          + Add issue
        </Button>
        <span className={styles.grow} />
        <Button variant="ghost" size="sm" onPress={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" loading={saving} data-testid="edit-save">
          Save
        </Button>
      </div>
    </form>
  );
}
