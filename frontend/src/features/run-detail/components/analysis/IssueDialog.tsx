/** Add / edit / delete one root-cause issue of a metric (brief 04 J8). */
import { useEffect, useRef, useState } from 'react';
import { useCategoryCatalogQuery, useIssueAction } from '@/api/runs';
import { Button, Dialog, Select, Textarea, TextField } from '@/ui';
import { messageFor } from '../items/ScoreEditor';
import { useRunPage } from '../../RunContext';
import type { RootCauseIssue, Row } from '../../types';
import styles from './MetricAnalysisCards.module.css';

const NEW = '__new__';

export interface IssueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function IssueDialog({ open, onOpenChange, row, metric, issue, passNumber }: IssueDialogProps) {
  const { runId, slug, model } = useRunPage();
  const catalog = useCategoryCatalogQuery(slug, open);
  const mutation = useIssueAction(runId);
  const [category, setCategory] = useState(issue?.category ?? '');
  const [customCategory, setCustomCategory] = useState('');
  const [subcategory, setSubcategory] = useState(issue?.subcategory ?? '');
  const [finding, setFinding] = useState(issue?.finding ?? '');
  const [reason, setReason] = useState(issue?.category_reason ?? '');
  const [solution, setSolution] = useState(issue?.solution ?? '');
  const [solutionNote, setSolutionNote] = useState(issue?.solution_note ?? '');
  const [message, setMessage] = useState('');
  const clientId = useRef(uuid());

  // Typed-in work: an accidental click on the backdrop must not throw it away (Escape and Cancel still close).
  const dirty =
    category !== (issue?.category ?? '') ||
    customCategory !== '' ||
    subcategory !== (issue?.subcategory ?? '') ||
    finding !== (issue?.finding ?? '') ||
    reason !== (issue?.category_reason ?? '') ||
    solution !== (issue?.solution ?? '') ||
    solutionNote !== (issue?.solution_note ?? '');

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
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory(issue?.category ?? '');
    setSubcategory(issue?.subcategory ?? '');
    setFinding(issue?.finding ?? '');
    setReason(issue?.category_reason ?? '');
    setSolution(issue?.solution ?? '');
    setSolutionNote(issue?.solution_note ?? '');
    setMessage('');
    clientId.current = uuid();
  }, [open, issue]);

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
    { key: NEW, label: 'New category…' },
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
        else onOpenChange(false);
      },
      onError: (e) => setMessage(messageFor(e)),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissOnBackdrop={!dirty}
      size="lg"
      title={issue ? `Edit issue · ${metric}` : `Add issue · ${metric}`}
      data-testid="issue-dialog"
      footer={
        <>
          {issue ? (
            <Button variant="danger" onPress={() => submit('delete')} isDisabled={mutation.isPending}>
              Delete issue
            </Button>
          ) : null}
          <Button variant="neutral" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!issue ? (
            <Button variant="neutral" onPress={() => submit('add', true)} isDisabled={mutation.isPending}>
              Save and add another
            </Button>
          ) : null}
          <Button
            variant="accent"
            onPress={() => submit(issue ? 'edit' : 'add')}
            loading={mutation.isPending}
            data-testid="issue-save"
          >
            Save
          </Button>
        </>
      }
    >
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
    </Dialog>
  );
}
