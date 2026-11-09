/** Root-cause issues (AI vs Human columns) and the inline human-diagnosis edit form. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { RootCauseIssue } from '@/api/reviews';
import { useCategoryCatalogQuery } from '@/api/runs';
import { textDirAttrs } from '@/lib/text';
import { Button, IconButton, Select, Text, TextField, Textarea, Icon } from '@/ui';
import styles from './IssueList.module.css';

const NEW_CATEGORY = '__new__';
const BLANK: RootCauseIssue = { category: '', subcategory: '', finding: '' };

/** The fields the edit form saves, the same fields as the run page's issue dialog. */
export function editableIssue(i: RootCauseIssue): RootCauseIssue {
  return {
    ...(i.issue_id ? { issue_id: i.issue_id } : {}),
    category: i.category.trim(),
    subcategory: (i.subcategory ?? '').trim(),
    finding: (i.finding ?? '').trim(),
    category_reason: (i.category_reason ?? '').trim(),
    solution: (i.solution ?? '').trim(),
    solution_note: (i.solution_note ?? '').trim(),
  };
}

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
            {typeof i.confidence === 'number' ? (
              <Text as="span" variant="sm" tone="muted">
                {Math.round(i.confidence * 100)}% confidence
              </Text>
            ) : null}
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

/** The project's catalog categories, plus "New category" for a name that is not in it yet. */
function CategoryField({
  projectSlug,
  value,
  onChange,
  errorMessage,
}: {
  projectSlug: string;
  value: string;
  onChange: (value: string) => void;
  errorMessage?: string;
}) {
  const catalog = useCategoryCatalogQuery(projectSlug);
  const known = catalog.data?.categories ?? [];
  const [typing, setTyping] = useState(false);
  const items = [
    ...known.map((c) => ({ key: c, label: c })),
    ...(!typing && value && !known.includes(value) ? [{ key: value, label: value }] : []),
    { key: NEW_CATEGORY, label: 'New category' },
  ];
  const guide = value ? catalog.data?.category_taxonomy?.[value] : undefined;
  return (
    <div className={styles.category}>
      <Select
        label="Category"
        items={items}
        value={typing ? NEW_CATEGORY : value || null}
        placeholder="Choose a category"
        searchable="auto"
        isRequired
        help={
          guide?.description
            ? `${guide.description}${guide.when_to_use ? ` Use when: ${guide.when_to_use}` : ''}`
            : undefined
        }
        errorMessage={typing ? undefined : errorMessage}
        onChange={(k) => {
          setTyping(k === NEW_CATEGORY);
          onChange(k === null || k === NEW_CATEGORY ? '' : String(k));
        }}
      />
      {typing ? (
        <TextField
          label="New category"
          value={value}
          onChange={onChange}
          isRequired
          autoFocus
          errorMessage={errorMessage}
        />
      ) : null}
    </div>
  );
}

/**
 * Edits the diagnosis of one correction. A correction of one issue (`single`, every new
 * correction) edits exactly that issue: the server stores one issue per correction, so a
 * second issue is added on the run page. Only a legacy grouped correction edits a list.
 */
export function IssueEditForm({
  initial,
  single,
  projectSlug,
  runHref,
  saving,
  onSave,
  onCancel,
}: {
  initial: RootCauseIssue[];
  single: boolean;
  projectSlug: string;
  runHref: string | null;
  saving: boolean;
  onSave: (issues: RootCauseIssue[]) => void;
  onCancel: () => void;
}) {
  const [issues, setIssues] = useState<RootCauseIssue[]>(() => {
    const seeded = initial.map((i) => ({ ...i }));
    if (!seeded.length) return [{ ...BLANK }];
    return single ? seeded.slice(0, 1) : seeded;
  });
  const [touched, setTouched] = useState(false);
  const patch = (n: number, p: Partial<RootCauseIssue>) =>
    setIssues((list) => list.map((x, i) => (i === n ? { ...x, ...p } : x)));
  const invalid = issues.some((i) => !i.category.trim());
  return (
    <form
      className={styles.form}
      data-edit-form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!invalid) onSave(issues.map(editableIssue));
      }}
    >
      {issues.map((i, n) => (
        <fieldset key={n} className={styles.fieldset}>
          <legend>Issue {n + 1}</legend>
          <div className={styles.fieldRow}>
            <CategoryField
              projectSlug={projectSlug}
              value={i.category}
              onChange={(v) => patch(n, { category: v })}
              errorMessage={touched && !i.category.trim() ? 'Category is required.' : undefined}
            />
            <TextField
              label="Subcategory"
              value={i.subcategory ?? ''}
              onChange={(v) => patch(n, { subcategory: v })}
            />
            {!single && issues.length > 1 ? (
              <IconButton
                label={`Remove issue ${n + 1}`}
                icon="trash"
                tone="danger"
                className={styles.remove}
                onPress={() => setIssues((l) => l.filter((_, k) => k !== n))}
              />
            ) : null}
          </div>
          <Textarea
            label="Finding"
            value={i.finding ?? ''}
            onChange={(v) => patch(n, { finding: v })}
            rows={2}
            autoFocus={n === 0}
          />
          <Textarea
            label="Why this category"
            value={i.category_reason ?? ''}
            onChange={(v) => patch(n, { category_reason: v })}
            rows={2}
          />
          <TextField label="Solution" value={i.solution ?? ''} onChange={(v) => patch(n, { solution: v })} />
          <Textarea
            label="Solution notes"
            value={i.solution_note ?? ''}
            onChange={(v) => patch(n, { solution_note: v })}
            rows={2}
          />
        </fieldset>
      ))}
      <div className={styles.formActions}>
        {single ? (
          runHref ? (
            <Link to={runHref} className={styles.runLink} data-testid="edit-add-on-run">
              Add another issue on the run page
            </Link>
          ) : null
        ) : (
          <Button
            icon={<Icon name="plus" size={12} />}
            variant="neutral"
            size="sm"
            onPress={() => setIssues((l) => [...l, { ...BLANK }])}
          >
            Add issue
          </Button>
        )}
        <span className={styles.grow} />
        <Button variant="neutral" size="sm" onPress={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" loading={saving} data-testid="edit-save">
          Save
        </Button>
      </div>
    </form>
  );
}
