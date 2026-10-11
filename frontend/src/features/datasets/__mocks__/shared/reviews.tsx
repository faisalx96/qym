import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import {
  Badge,
  Button,
  Dialog,
  Eyebrow,
  HelpMarker,
  Icon,
  IconButton,
  Kbd,
  MultiSelect,
  SegmentedControl,
  Slider,
  Tabs,
  Tag,
  Text,
  TextField,
  Textarea,
  useToast,
} from '@/ui';
import { textDirAttrs } from '@/lib/text';
import { corrections as seed, reviewFacets, NOW, type Correction, type Issue } from '../fixtures';
import styles from './reviews.module.css';

/* ---------- state ---------- */

export type StatusTab = 'pending' | 'approved' | 'rejected' | 'all';
export type BulkAction = 'approve' | 'reject' | 'reset' | 'delete';

export function priority(row: Correction): 'High' | 'Medium' | null {
  const conf = row.ai_confidence;
  const changed = JSON.stringify(row.ai_root_cause_issues) !== JSON.stringify(row.human_root_cause_issues);
  const days = (NOW.getTime() - new Date(row.created_at).getTime()) / 86_400_000;
  if ((conf != null && conf < 0.5) || days >= 14) return 'High';
  if ((conf != null && conf < 0.75) || changed) return 'Medium';
  return null;
}

export function bulkFits(rows: Correction[], action: BulkAction): Correction[] {
  if (action === 'approve' || action === 'reject') return rows.filter((r) => r.status === 'pending' && !r.review_block);
  if (action === 'reset') return rows.filter((r) => r.status !== 'pending');
  return rows;
}

export function useReviewState() {
  const toast = useToast();
  const [rows, setRows] = useState<Correction[]>(seed);
  const [tab, setTab] = useState<StatusTab>('pending');
  const [selected, setSelected] = useState<Set<Key>>(new Set());
  const [currentId, setCurrentId] = useState<number | null>(seed[0]?.id ?? null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [comment, setComment] = useState<{ kind: 'reject'; id: number } | { kind: 'bulk'; action: BulkAction } | null>(
    null,
  );
  const [conflict, setConflict] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const bulkAttempts = useRef(0);

  const counts = useMemo(
    () => ({
      pending: rows.filter((r) => r.status === 'pending').length,
      approved: rows.filter((r) => r.status === 'approved').length,
      rejected: rows.filter((r) => r.status === 'rejected').length,
      all: rows.length,
    }),
    [rows],
  );
  const visible = useMemo(() => rows.filter((r) => tab === 'all' || r.status === tab), [rows, tab]);
  const current = visible.find((r) => r.id === currentId) ?? visible[0] ?? null;

  const move = useCallback(
    (delta: number) => {
      if (!visible.length) return;
      const i = Math.max(0, visible.findIndex((r) => r.id === current?.id));
      const next = visible[Math.min(visible.length - 1, Math.max(0, i + delta))];
      if (next) setCurrentId(next.id);
    },
    [visible, current],
  );

  const patch = useCallback((id: number, p: Partial<Correction>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }, []);

  const advance = useCallback(
    (fromId: number) => {
      const i = visible.findIndex((r) => r.id === fromId);
      const next = visible.slice(i + 1).find((r) => r.status === 'pending') ?? visible[i + 1] ?? visible[i - 1] ?? null;
      setCurrentId(next?.id ?? null);
    },
    [visible],
  );

  const approve = useCallback(
    (row: Correction) => {
      if (row.review_block) {
        toast.show(`Not allowed: ${row.review_block}`, { tone: 'error' });
        return;
      }
      if (row.status !== 'pending') return;
      patch(row.id, { status: 'approved', reviewed_at: NOW.toISOString(), reviewed_by: { id: 1, email: 'dev@local', display_name: 'Dev User' } });
      toast.show(`#${row.id} approved`, { tone: 'success' });
      if (tab === 'pending') advance(row.id);
    },
    [patch, toast, tab, advance],
  );
  const reject = useCallback(
    (row: Correction, text: string) => {
      patch(row.id, { status: 'rejected', review_comment: text || null, reviewed_at: NOW.toISOString(), reviewed_by: { id: 1, email: 'dev@local', display_name: 'Dev User' } });
      toast.show(`#${row.id} rejected`, { tone: 'success' });
      if (tab === 'pending') advance(row.id);
    },
    [patch, toast, tab, advance],
  );
  const reset = useCallback(
    (row: Correction) => {
      patch(row.id, { status: 'pending', review_comment: null, reviewed_at: null, reviewed_by: null });
      toast.show(`#${row.id} back in the queue`);
    },
    [patch, toast],
  );
  const requestReject = useCallback((row: Correction) => {
    if (row.review_block || row.status !== 'pending') return;
    setComment({ kind: 'reject', id: row.id });
  }, []);
  const requestBulk = useCallback(
    (action: BulkAction) => {
      const rowsSel = rows.filter((r) => selected.has(r.id));
      const fit = bulkFits(rowsSel, action);
      if (!fit.length) {
        toast.show(`None of the selected corrections can be ${action === 'reset' ? 'reset' : action + 'd'}`, { tone: 'error' });
        return;
      }
      if (action === 'reset') {
        fit.forEach(reset);
        setSelected(new Set());
        return;
      }
      setComment({ kind: 'bulk', action });
    },
    [rows, selected, toast, reset],
  );
  const confirmComment = useCallback(
    (text: string) => {
      if (!comment) return;
      if (comment.kind === 'reject') {
        const row = rows.find((r) => r.id === comment.id);
        if (row) reject(row, text);
        setComment(null);
        return;
      }
      // Bulk: the first attempt simulates the server's 409 (expected_count / expected_status drift).
      bulkAttempts.current += 1;
      if (bulkAttempts.current === 1) {
        setComment(null);
        setConflict('The list changed while you were selecting: 1 of the selected corrections was reviewed by Omar Haddad.');
        return;
      }
      const fit = bulkFits(
        rows.filter((r) => selected.has(r.id)),
        comment.action,
      );
      setRows((prev) =>
        prev.map((r) =>
          fit.some((f) => f.id === r.id)
            ? { ...r, status: comment.action === 'approve' ? 'approved' : 'rejected', review_comment: text || null }
            : r,
        ),
      );
      toast.show(`${fit.length} corrections ${comment.action}d`, { tone: 'success' });
      setSelected(new Set());
      setComment(null);
    },
    [comment, rows, reject, selected, toast],
  );
  const reloadAfterConflict = useCallback(() => {
    setConflict(null);
    setSelected(new Set());
    toast.show('List reloaded. Select again to retry.');
  }, [toast]);

  const toggleExpanded = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const toggleSelected = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const saveEdit = useCallback(
    (id: number, issues: Issue[]) => {
      patch(id, { human_root_cause_issues: issues });
      setEditing(null);
      toast.show('Diagnosis saved', { tone: 'success' });
    },
    [patch, toast],
  );

  return {
    rows,
    visible,
    counts,
    tab,
    setTab: (t: StatusTab) => {
      setTab(t);
      setSelected(new Set());
    },
    selected,
    setSelected,
    current,
    setCurrentId,
    move,
    expanded,
    toggleExpanded,
    toggleSelected,
    editing,
    setEditing,
    saveEdit,
    approve,
    reject,
    reset,
    requestReject,
    requestBulk,
    comment,
    setComment,
    confirmComment,
    conflict,
    reloadAfterConflict,
    help,
    setHelp,
  };
}
export type ReviewState = ReturnType<typeof useReviewState>;

/* ---------- keyboard ---------- */

export function useTriageKeys(s: ReviewState, searchRef: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && typing) {
        (t as HTMLElement).blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (s.comment || s.conflict || s.help || s.editing != null) return;
      const row = s.current;
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault();
          s.move(1);
          break;
        case 'k':
        case 'ArrowUp':
          e.preventDefault();
          s.move(-1);
          break;
        case 'a':
          if (row) s.approve(row);
          break;
        case 'A':
          if (e.shiftKey) s.requestBulk('approve');
          break;
        case 'r':
          if (row) s.requestReject(row);
          break;
        case 'e':
          if (row) s.setEditing(row.id);
          break;
        case 'o':
        case 'Enter':
          if (row) s.toggleExpanded(row.id);
          break;
        case 'x':
          if (row) s.toggleSelected(row.id);
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case '?':
          s.setHelp(true);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, searchRef]);
}

/* ---------- pieces ---------- */

export function StatusTabs({ s, variant = 'dense' }: { s: ReviewState; variant?: 'dense' | 'underline' }) {
  return (
    <Tabs
      label="Review status"
      variant={variant}
      selected={s.tab}
      onSelect={(id) => s.setTab(id as StatusTab)}
      items={[
        { id: 'pending', label: 'To review', count: s.counts.pending },
        { id: 'approved', label: 'Approved', count: s.counts.approved },
        { id: 'rejected', label: 'Rejected', count: s.counts.rejected, tone: s.counts.rejected ? 'danger' : undefined },
        { id: 'all', label: 'All', count: s.counts.all },
      ]}
    />
  );
}

export function QueueLine({ s }: { s: ReviewState }) {
  const reviewed = s.counts.approved + s.counts.rejected;
  const pct = s.counts.all ? Math.round((reviewed / s.counts.all) * 100) : 0;
  return (
    <span className={styles.queueLine}>
      <span>
        Queue: <strong>{s.counts.pending}</strong> to review
      </span>
      <span aria-hidden="true">·</span>
      <span>
        {reviewed} of {s.counts.all} reviewed
      </span>
      <span className={styles.progress} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Reviewed">
        <span className={styles.progressFill} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export function StatusBadge({ row }: { row: Correction }) {
  const tone = row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning';
  return (
    <Badge tone={tone} dot>
      {row.status}
    </Badge>
  );
}

export function PriorityTag({ row }: { row: Correction }) {
  const p = priority(row);
  if (!p) return null;
  return <Tag tone={p === 'High' ? 'danger' : 'warning'}>{p} priority</Tag>;
}

export function ContextChips({ row, project }: { row: Correction; project?: boolean }) {
  return (
    <span className={styles.chips}>
      <Tag kind="data">task {row.task}</Tag>
      {row.metric_name ? <Tag kind="data">metric {row.metric_name}</Tag> : null}
      {project ? <Tag>{row.project_name}</Tag> : null}
      <Tag kind="data">
        <a className={styles.chipLink} href={`/app/projects/${row.project_slug}/runs/${row.run_id}?pass=${row.pass_number}&item=${row.item_id}`} onClick={(e) => e.preventDefault()}>
          run {row.run_name.slice(0, 28)}… <Icon name="external" size={12} />
        </a>
      </Tag>
      <Tag>{row.dataset}</Tag>
      <Tag>
        {row.model}
        {row.has_reasoning ? ' · reasoning' : ''}
      </Tag>
    </span>
  );
}

function issueKey(i: Issue) {
  return `${i.category}|${i.subcategory ?? ''}|${i.finding}`;
}

function IssueCard({ issue, state }: { issue: Issue; state: 'same' | 'changed' | 'removed' }) {
  return (
    <div className={styles.issue} data-state={state}>
      <div className={styles.issueCat}>{issue.category}</div>
      {issue.subcategory ? <div className={styles.issueSub}>{issue.subcategory}</div> : null}
      <div className={styles.issueFinding} {...textDirAttrs(issue.finding)}>
        {issue.finding}
      </div>
      {issue.category_reason ? (
        <details className={styles.issueWhy}>
          <summary>Why this category</summary>
          {issue.category_reason}
        </details>
      ) : null}
      {issue.confidence != null ? <div className={styles.issueMeta}>confidence {Math.round(issue.confidence * 100)}%</div> : null}
    </div>
  );
}

/** Two columns AI vs Human; human issues that differ are highlighted, AI ones that disappeared are "removed". */
export function IssueColumns({ row }: { row: Correction }) {
  const human = new Set(row.human_root_cause_issues.map(issueKey));
  const ai = new Set(row.ai_root_cause_issues.map(issueKey));
  return (
    <div className={styles.issueCols}>
      <div className={styles.issueCol}>
        <div className={styles.issueColHead}>
          <Eyebrow>AI</Eyebrow>
          <Text variant="sm" tone="muted">
            root-cause issues
          </Text>
          {row.ai_confidence != null ? <Tag kind="count">{Math.round(row.ai_confidence * 100)}%</Tag> : null}
        </div>
        {row.ai_root_cause_issues.length ? (
          row.ai_root_cause_issues.map((i) => <IssueCard key={issueKey(i)} issue={i} state={human.has(issueKey(i)) ? 'same' : 'removed'} />)
        ) : (
          <span className={styles.emptyCol}>No AI diagnosis — human-submitted correction</span>
        )}
      </div>
      <div className={styles.issueCol}>
        <div className={styles.issueColHead}>
          <Eyebrow tone="accent">Human</Eyebrow>
          <Text variant="sm" tone="muted">
            root-cause issues
          </Text>
        </div>
        {row.human_root_cause_issues.map((i) => (
          <IssueCard key={issueKey(i)} issue={i} state={ai.has(issueKey(i)) ? 'same' : 'changed'} />
        ))}
      </div>
    </div>
  );
}

/** One diff-style block: unchanged issues once, removed AI lines struck through, human additions marked. */
export function IssueDiff({ row }: { row: Correction }) {
  const human = row.human_root_cause_issues;
  const ai = row.ai_root_cause_issues;
  const humanKeys = new Set(human.map(issueKey));
  const aiKeys = new Set(ai.map(issueKey));
  const line = (i: Issue) => (
    <span className={styles.diffLine} {...textDirAttrs(i.finding)}>
      <strong>{i.category}</strong>
      {i.subcategory ? ` · ${i.subcategory}` : ''} — {i.finding}
    </span>
  );
  return (
    <div className={styles.diff}>
      {ai.map((i) =>
        humanKeys.has(issueKey(i)) ? (
          <div key={`s-${issueKey(i)}`} className={styles.diffRow} data-kind="same">
            <Eyebrow>Both</Eyebrow>
            {line(i)}
          </div>
        ) : (
          <div key={`a-${issueKey(i)}`} className={styles.diffRow} data-kind="ai" data-changed="">
            <Eyebrow>AI</Eyebrow>
            <span className={styles.diffLine} data-removed="" {...textDirAttrs(i.finding)}>
              <strong>{i.category}</strong>
              {i.subcategory ? ` · ${i.subcategory}` : ''} — {i.finding}
            </span>
          </div>
        ),
      )}
      {!ai.length ? (
        <div className={styles.diffRow} data-kind="ai">
          <Eyebrow>AI</Eyebrow>
          <span className={styles.emptyCol}>No AI diagnosis — human-submitted correction</span>
        </div>
      ) : null}
      {human
        .filter((i) => !aiKeys.has(issueKey(i)))
        .map((i) => (
          <div key={`h-${issueKey(i)}`} className={styles.diffRow} data-kind="human">
            <Eyebrow tone="accent">Human</Eyebrow>
            {line(i)}
          </div>
        ))}
    </div>
  );
}

export function DecisionButtons({ row, s, compact }: { row: Correction; s: ReviewState; compact?: boolean }) {
  const blocked = Boolean(row.review_block);
  const pending = row.status === 'pending';
  return (
    <span className={styles.decisions}>
      {pending ? (
        <>
          <IconButton label="Approve (a)" icon="check" tone="approve" isDisabled={blocked} onPress={() => s.approve(row)} />
          <IconButton label="Reject (r)" icon="close" tone="reject" isDisabled={blocked} onPress={() => s.requestReject(row)} />
          {blocked ? <HelpMarker label="why approve and reject are disabled">{row.review_block}</HelpMarker> : null}
        </>
      ) : (
        <IconButton label="Reset to pending" icon="retry" onPress={() => s.reset(row)} />
      )}
      <IconButton label="Edit diagnosis (e)" icon="edit" onPress={() => s.setEditing(row.id)} />
      {compact ? null : (
        <IconButton label="Delete correction" icon="trash" tone="danger" onPress={() => undefined} />
      )}
    </span>
  );
}

export function BulkBar({ s }: { s: ReviewState }) {
  const sel = s.rows.filter((r) => s.selected.has(r.id));
  if (!sel.length) return null;
  const fit = (a: BulkAction) => bulkFits(sel, a).length;
  const label = (text: string, a: BulkAction) => {
    const n = fit(a);
    return (
      <span className={styles.badgeOnButton}>
        {text}
        {n !== sel.length ? <Tag kind="count">{n}</Tag> : null}
      </span>
    );
  };
  return (
    <div className={styles.bulkBar} role="region" aria-label="Bulk actions">
      <span className={styles.bulkCount}>{sel.length} selected</span>
      <Button variant="accent" size="sm" isDisabled={!fit('approve')} onPress={() => s.requestBulk('approve')}>
        {label('Approve', 'approve')}
      </Button>
      <Button size="sm" isDisabled={!fit('reject')} onPress={() => s.requestBulk('reject')}>
        {label('Reject', 'reject')}
      </Button>
      <Button size="sm" isDisabled={!fit('reset')} onPress={() => s.requestBulk('reset')}>
        {label('Reset', 'reset')}
      </Button>
      <Button size="sm" variant="danger" onPress={() => s.requestBulk('delete')}>
        Delete
      </Button>
      <IconButton label="Clear selection" icon="close" onPress={() => s.setSelected(new Set())} />
    </div>
  );
}

export function Previews({ row, full }: { row: Correction; full?: boolean }) {
  const block = (label: string, text: string) => (
    <div className={styles.previewBlock}>
      <Eyebrow>{label}</Eyebrow>
      <div className={styles.previewText} data-full={full ? '' : undefined} {...textDirAttrs(text)}>
        {text}
      </div>
    </div>
  );
  return (
    <div className={styles.previews}>
      {block('Input', row.input_preview)}
      {block('Expected', row.expected_preview)}
      {block('Output', row.output_preview)}
    </div>
  );
}

/** The lazily loaded detail (snapshots, revision history, metric scores, item metadata). */
export function CardDetail({ row }: { row: Correction }) {
  return (
    <div className={styles.detail}>
      <Previews row={row} full />
      <div>
        <Eyebrow>Revision history</Eyebrow>
        <div className={styles.history}>
          <div className={styles.historyRow}>
            <Tag kind="count">#1</Tag>
            <span>{row.corrected_by?.display_name ?? 'AI'} submitted the human diagnosis</span>
            <Text variant="sm" tone="muted" mono>
              2026-10-11 19:18
            </Text>
          </div>
          {row.reviewed_at ? (
            <div className={styles.historyRow}>
              <Tag kind="count">#2</Tag>
              <span>
                {row.reviewed_by?.display_name} {row.status} it{row.review_comment ? ` — "${row.review_comment}"` : ''}
              </span>
              <Text variant="sm" tone="muted" mono>
                2026-10-11 19:40
              </Text>
            </div>
          ) : null}
        </div>
      </div>
      <div>
        <Eyebrow>Metric scores</Eyebrow>
        <span className={styles.chips}>
          {Object.entries(row.scores_snapshot).map(([k, v]) => (
            <Tag key={k} kind="data">
              {k} {v}
            </Tag>
          ))}
        </span>
      </div>
      <div>
        <Eyebrow>Item metadata</Eyebrow>
        <pre className={styles.previewText} data-full="">
          {JSON.stringify(row.item_metadata, null, 2)}
        </pre>
      </div>
    </div>
  );
}

export function ReviewedLine({ row }: { row: Correction }) {
  if (!row.reviewed_by) return null;
  return (
    <div className={styles.footerLine}>
      Reviewed by {row.reviewed_by.display_name} · 2026-10-11 19:40
      {row.review_comment ? <span>— “{row.review_comment}”</span> : null}
    </div>
  );
}

export function EditForm({ row, s }: { row: Correction; s: ReviewState }) {
  const [issues, setIssues] = useState<Issue[]>(row.human_root_cause_issues.length ? row.human_root_cause_issues : [{ category: '', finding: '' }]);
  const update = (i: number, p: Partial<Issue>) => setIssues((prev) => prev.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const valid = issues.every((i) => i.category.trim());
  const esc = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      s.setEditing(null);
    }
  };
  return (
    <form
      className={styles.editForm}
      aria-label="Edit human diagnosis"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) s.saveEdit(row.id, issues);
      }}
    >
      <Text variant="md">Human diagnosis</Text>
      {issues.map((issue, i) => (
        <div key={i} className={styles.editIssue}>
          <TextField label="Category" isRequired value={issue.category} onChange={(v) => update(i, { category: v })} autoFocus={i === 0} onKeyDown={esc} />
          <TextField label="Subcategory" value={issue.subcategory ?? ''} onChange={(v) => update(i, { subcategory: v })} onKeyDown={esc} />
          <span className={styles.editIssueRemove}>
            <IconButton label={`Remove issue ${i + 1}`} icon="trash" tone="danger" isDisabled={issues.length === 1} onPress={() => setIssues((prev) => prev.filter((_, j) => j !== i))} />
          </span>
          <Textarea label="Finding" rows={2} value={issue.finding} onChange={(v) => update(i, { finding: v })} onKeyDown={esc} />
        </div>
      ))}
      <span className={styles.chips}>
        <Button variant="ghost" icon={<Icon name="plus" size={12} />} onPress={() => setIssues((p) => [...p, { category: '', finding: '' }])}>
          Add issue
        </Button>
        <span style={{ flex: 1 }} />
        <Button onPress={() => s.setEditing(null)}>Cancel</Button>
        <Button variant="primary" type="submit" isDisabled={!valid}>
          Save
        </Button>
      </span>
    </form>
  );
}

/* ---------- dialogs ---------- */

export function CommentDialog(props: { s: ReviewState; viewLabel: string }) {
  return <CommentDialogInner key={props.s.comment ? 'open' : 'closed'} {...props} />;
}

function CommentDialogInner({ s, viewLabel }: { s: ReviewState; viewLabel: string }) {
  const [text, setText] = useState('');
  const c = s.comment;
  const open = Boolean(c);
  const fit = c?.kind === 'bulk' ? bulkFits(s.rows.filter((r) => s.selected.has(r.id)), c.action).length : 1;
  const title = c?.kind === 'reject' ? `Reject #${c.id}` : c?.kind === 'bulk' ? `${c.action === 'approve' ? 'Approve' : c.action === 'reject' ? 'Reject' : 'Delete'} ${fit} corrections` : '';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && s.setComment(null)}
      title={title}
      description={c?.kind === 'bulk' ? `Applies to the ${fit} fitting corrections selected in ${viewLabel}.` : 'An optional comment is kept with the decision.'}
      size="sm"
      footer={
        <>
          <Button onPress={() => s.setComment(null)}>Cancel</Button>
          <Button variant={c?.kind === 'bulk' && c.action === 'delete' ? 'danger' : 'primary'} onPress={() => s.confirmComment(text)}>
            Confirm
          </Button>
        </>
      }
    >
      <Textarea
        label="Comment"
        rows={3}
        value={text}
        onChange={setText}
        autoFocus
        help={
          <span>
            <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> confirms
          </span>
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) s.confirmComment(text);
        }}
      />
    </Dialog>
  );
}

export function ConflictDialog({ s }: { s: ReviewState }) {
  return (
    <Dialog
      open={Boolean(s.conflict)}
      onOpenChange={(o) => !o && s.reloadAfterConflict()}
      role="alertdialog"
      title="The list changed"
      description={s.conflict ?? ''}
      size="sm"
      footer={
        <Button variant="primary" icon={<Icon name="retry" size={12} />} onPress={s.reloadAfterConflict}>
          Reload and select again
        </Button>
      }
    >
      <Text variant="base" tone="secondary">
        Nothing was changed. The server refused the bulk action because the expected count and status no longer
        match (409).
      </Text>
    </Dialog>
  );
}

export function ShortcutsDialog({ s }: { s: ReviewState }) {
  const rows: [string, string][] = [
    ['j / k', 'Next / previous correction'],
    ['a', 'Approve'],
    ['r', 'Reject (with comment)'],
    ['e', 'Edit the human diagnosis'],
    ['o / Enter', 'Toggle details'],
    ['x', 'Select'],
    ['Shift + A', 'Approve selected'],
    ['/', 'Focus search'],
    ['?', 'This help'],
    ['Esc', 'Close / cancel'],
  ];
  return (
    <Dialog open={s.help} onOpenChange={s.setHelp} title="Keyboard shortcuts" size="sm">
      <div className={styles.shortcuts}>
        {rows.map(([k, d]) => (
          <span key={k} style={{ display: 'contents' }}>
            <span>
              {k.split(' / ').map((part, i) => (
                <span key={part}>
                  {i ? ' / ' : ''}
                  <Kbd>{part}</Kbd>
                </span>
              ))}
            </span>
            <span>{d}</span>
          </span>
        ))}
      </div>
    </Dialog>
  );
}

/* ---------- filters ---------- */

export interface FilterState {
  tasks: Set<Key>;
  datasets: Set<Key>;
  models: Set<Key>;
  runs: Set<Key>;
  source: 'all' | 'ai' | 'human' | 'corrected';
  confMin: number;
  confMax: number;
}
export const emptyFilters: FilterState = { tasks: new Set(), datasets: new Set(), models: new Set(), runs: new Set(), source: 'all', confMin: 0, confMax: 100 };

export function activeFilterChips(f: FilterState): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  f.tasks.forEach((k) => out.push({ key: `task:${k}`, label: `task ${k}` }));
  f.datasets.forEach((k) => out.push({ key: `dataset:${k}`, label: `dataset ${k}` }));
  f.models.forEach((k) => out.push({ key: `model:${k}`, label: `model ${k}` }));
  f.runs.forEach((k) => out.push({ key: `run:${k}`, label: `run ${String(k).slice(0, 18)}…` }));
  if (f.source !== 'all') out.push({ key: 'source', label: `source ${f.source}` });
  if (f.confMin > 0 || f.confMax < 100) out.push({ key: 'conf', label: `confidence ${f.confMin}–${f.confMax}%` });
  return out;
}

export function FacetFilters({ f, onChange, layout = 'stack' }: { f: FilterState; onChange: (f: FilterState) => void; layout?: 'stack' | 'row' }) {
  const set = (p: Partial<FilterState>) => onChange({ ...f, ...p });
  const facets = (
    <>
      <MultiSelect label="Tasks" items={reviewFacets.tasks} value={f.tasks} onChange={(v) => set({ tasks: v })} />
      <MultiSelect label="Datasets" items={reviewFacets.datasets} value={f.datasets} onChange={(v) => set({ datasets: v })} />
      <MultiSelect label="Models" items={reviewFacets.models} value={f.models} onChange={(v) => set({ models: v })} />
      <MultiSelect label="Runs" items={reviewFacets.runs} value={f.runs} onChange={(v) => set({ runs: v })} />
    </>
  );
  const source = (
    <SegmentedControl
      label="Source"
      value={f.source}
      onChange={(v) => set({ source: v })}
      options={[
        { value: 'all', label: 'All' },
        { value: 'ai', label: 'AI only' },
        { value: 'human', label: 'Human only' },
        { value: 'corrected', label: 'AI+Human' },
      ]}
    />
  );
  const conf = (
    <div className={styles.confidence}>
      <Slider label="Confidence min" unit="%" minValue={0} maxValue={100} step={5} value={f.confMin} onChange={(v) => set({ confMin: Math.min(v as number, f.confMax) })} />
      <Slider label="Confidence max" unit="%" minValue={0} maxValue={100} step={5} value={f.confMax} onChange={(v) => set({ confMax: Math.max(v as number, f.confMin) })} />
    </div>
  );
  if (layout === 'row')
    return (
      <>
        {facets}
        {source}
        {conf}
      </>
    );
  return (
    <div className={styles.filters}>
      <div className={styles.filtersRow}>{facets}</div>
      {source}
      {conf}
    </div>
  );
}

export function LinkedLabel({ children }: { children: ReactNode }) {
  return <span className={styles.linkedLabel}>{children}</span>;
}
