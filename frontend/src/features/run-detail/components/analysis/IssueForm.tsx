/**
 * Add / edit / delete one root-cause issue of a metric (brief 04 J8). The form opens inline in the Root cause card,
 * under the item's Metrics table, so the evidence stays in view (C128). Delete asks first (C125).
 */
import { useRef, useState } from 'react';
import { useCategoryCatalogQuery, useIssueAction } from '@/api/runs';
import { Button, ConfirmDialog, Select, Textarea, TextField } from '@/ui';
import { messageFor } from '../items/ScoreEditor';
import { useRunPage } from '../../RunContext';
import type { RootCauseIssue, Row } from '../../types';
import styles from './MetricAnalysisCards.module.css';

const NEW = '__new__';

export interface IssueFormProps {
  onClose: () => void;
  row: Row;
  metric: string;
  /** null = a new issue. */
  issue: RootCauseIssue | null;
  passNumber: number | null;
}

function uuid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

export function IssueForm({ onClose, row, metric, issue, passNumber }: IssueFormProps) {
  const { runId, slug, model } = useRunPage();
  const catalog = useCategoryCatalogQuery(slug, true);
  const mutation = useIssueAction(runId);
  const [category, setCategory] = useState(issue?.category ?? '');
  const [customCategory, setCustomCategory] = useState('');
  const [subcategory, setSubcategory] = useState(issue?.subcategory ?? '');
  const [finding, setFinding] = useState(issue?.finding ?? '');
  const [reason, setReason] = useState(issue?.category_reason ?? '');
  const [solution, setSolution] = useState(issue?.solution ?? '');
  const [solutionNote, setSolutionNote] = useState(issue?.solution_note ?? '');
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const clientId = useRef(uuid());

  const reset = () => {
    setCategory('');
    setCustomCategory('');
    setSubcategory('');
    setFinding('');
    setReason('');
    setSolution('');
    setSolutionNote('');
    setMessage('');
    clientId.current = uuid();
  };
  const known = catalog.data?.categories ?? [];
  const inCatalog = !category || known.includes(category);
  const chosen =
    category === NEW || (!inCatalog && !!category)
      ? category === NEW
        ? customCategory
        : category
      : category;
  const guide = chosen && catalog.data?.category_taxonomy?.[chosen];
  const items = [
    ...known.map((c) => ({ key: c, label: c })),
    ...(!inCatalog && category && category !== NEW ? [{ key: category, label: category }] : []),
    { key: NEW, label: 'New category' },
  ];

  const body = (action: 'add' | 'edit' | 'delete') => ({
    run_id: runId,
    item_id: row.item_id,
    metric_name: metric,
    action,
    issue: {
      category: chosen.trim(),
      subcategory: subcategory.trim(),
      finding: finding.trim(),
      category_reason: reason.trim(),
      solution: solution.trim(),
      solution_note: solutionNote.trim(),
    },
    ...(action === 'add'
      ? { client_issue_id: clientId.current }
      : {
          issue_id: issue?.issue_id,
          expected_issue: (issue ?? undefined) as Record<string, unknown> | undefined,
        }),
    ...(passNumber ? { pass_number: passNumber, expected_pass_version: model.passRevision } : {}),
  });
  const submit = (action: 'add' | 'edit' | 'delete', again = false) => {
    if (action !== 'delete' && !chosen.trim()) {
      setMessage('Choose or type a category.');
      return;
    }
    setMessage('');
    mutation.mutate(body(action), {
      onSuccess: () => {
        if (again) reset();
        else onClose();
      },
      onError: (e) => setMessage(messageFor(e)),
    });
  };

  const title = issue ? `Edit issue · ${metric}` : `Add issue · ${metric}`;
  return (
    <section className={styles.inlineForm} aria-label={title} data-testid="issue-form">
      <h6 className={styles.formTitle}>{title}</h6>
      <div className={styles.form}>
        <Select
          label="Category"
          items={items}
          value={category === '' ? null : category}
          placeholder="Choose a category"
          searchable="auto"
          onChange={(k) => setCategory(k === null ? '' : String(k))}
        />
        {category === NEW ? (
          <TextField label="New category" value={customCategory} onChange={setCustomCategory} autoFocus />
        ) : null}
        {guide ? (
          <p className={styles.guide}>
            {guide.description}
            {guide.when_to_use ? ` Use when: ${guide.when_to_use}` : ''}
          </p>
        ) : null}
        <TextField label="Subcategory" value={subcategory} onChange={setSubcategory} />
        <Textarea label="Finding" value={finding} onChange={setFinding} rows={3} />
        <Textarea label="Why this category" value={reason} onChange={setReason} rows={2} />
        <TextField label="Solution" value={solution} onChange={setSolution} />
        <Textarea label="Solution notes" value={solutionNote} onChange={setSolutionNote} rows={2} />
        {message ? (
          <p className={styles.error} role="alert">
            {message}
          </p>
        ) : null}
      </div>
      <div className={styles.formActions}>
        {issue ? (
          <Button variant="danger" onPress={() => setConfirmDelete(true)} isDisabled={mutation.isPending}>
            Delete issue
          </Button>
        ) : null}
        <span className={styles.formSpacer} />
        <Button variant="neutral" onPress={onClose}>
          Cancel
        </Button>
        {!issue ? (
          <Button variant="neutral" onPress={() => submit('add', true)} isDisabled={mutation.isPending}>
            Save and add another
          </Button>
        ) : null}
        <Button
          variant="primary"
          onPress={() => submit(issue ? 'edit' : 'add')}
          loading={mutation.isPending}
          data-testid="issue-save"
        >
          Save
        </Button>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this issue?"
        description={`The ${issue?.category || 'issue'} issue on ${metric} and its review go away.`}
        confirmLabel="Delete issue"
        tone="danger"
        onConfirm={() => submit('delete')}
      />
    </section>
  );
}
