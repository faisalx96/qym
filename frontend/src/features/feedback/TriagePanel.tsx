import { useMemo, useRef, useState } from 'react';
import {
  useFeedbackList,
  useTriageFeedback,
  type FeedbackComplexity,
  type FeedbackDetail,
  type FeedbackPriority,
  type FeedbackStatus,
} from '@/api/feedback';
import { ApiError } from '@/lib/http';
import { Button, Card, Eyebrow, Select, Tag, Text, Textarea, useToast } from '@/ui';
import { cap } from './badges';
import { COMPLEXITY_ITEMS } from './ProposalCard';
import { PRIORITY_LABEL } from './proposalForm';
import styles from './feedback.module.css';

const STATUSES = (['new', 'accepted', 'planned', 'done', 'declined'] as const).map((k) => ({ key: k, label: cap(k) }));
const PRIORITIES = (Object.keys(PRIORITY_LABEL) as FeedbackPriority[]).map((k) => ({ key: k, label: PRIORITY_LABEL[k] }));
const NONE = '__none__';

interface Form {
  status: FeedbackStatus;
  priority: FeedbackPriority;
  complexity: FeedbackComplexity;
  duplicate: string;
  note: string;
}

export function pendingChanges(base: Form, form: Form): string[] {
  const out: string[] = [];
  if (form.status !== base.status) out.push(`Status ${cap(base.status)} to ${cap(form.status)}`);
  if (form.priority !== base.priority) out.push(`Priority ${PRIORITY_LABEL[base.priority]} to ${PRIORITY_LABEL[form.priority]}`);
  if (form.complexity !== base.complexity) out.push(`Complexity ${base.complexity} to ${form.complexity}`);
  if (form.duplicate !== base.duplicate)
    out.push(form.duplicate === NONE ? 'Duplicate link cleared' : `Duplicate of ${form.duplicate}`);
  return out;
}

export function noteRequired(base: Form, form: Form): boolean {
  return (
    form.priority !== base.priority ||
    form.complexity !== base.complexity ||
    form.duplicate !== base.duplicate ||
    (form.status === 'declined' && base.status !== 'declined')
  );
}

/** The administrator's panel (QE-97 to QE-108): one PATCH with only what changed, and a note for the history. */
export function TriagePanel({ detail }: { detail: FeedbackDetail }) {
  const req = detail.request;
  const base: Form = {
    status: req.status as FeedbackStatus,
    priority: (req.priority ?? 'medium') as FeedbackPriority,
    complexity: (req.complexity ?? 'M') as FeedbackComplexity,
    duplicate: req.duplicate_of ?? NONE,
    note: '',
  };
  // Remount-free reset: the panel re-initialises when the server's version of the request changes.
  const version = req.updated_at ?? '';
  const [seen, setSeen] = useState(version);
  const [form, setForm] = useState<Form>(base);
  if (seen !== version) {
    setSeen(version);
    setForm(base);
  }
  const [error, setError] = useState('');
  const [noteError, setNoteError] = useState('');
  const noteRef = useRef<HTMLTextAreaElement | null>(null);
  const toast = useToast();
  const triage = useTriageFeedback(req.ref);
  const candidates = useFeedbackList({ page_size: 100, sort: 'created_at:desc' });
  const dupItems = useMemo(() => {
    const rows = (candidates.data?.items ?? []).filter((r) => r.ref !== req.ref && !r.duplicate_of);
    return [
      { key: NONE, label: 'Not a duplicate' },
      ...(req.duplicate_of && !rows.some((r) => r.ref === req.duplicate_of)
        ? [{ key: req.duplicate_of, label: req.duplicate_of }]
        : []),
      ...rows.map((r) => ({ key: r.ref, label: `${r.ref} · ${r.title}` })),
    ];
  }, [candidates.data, req.ref, req.duplicate_of]);
  const changes = pendingChanges(base, form);
  const needNote = noteRequired(base, form);
  const declining = form.status === 'declined' && base.status !== 'declined';
  const noteMessage = declining ? 'Say why it is declined. The submitter sees this.' : 'Add a note: it is shown in the history.';
  const reset = () => {
    setForm(base);
    setError('');
    setNoteError('');
  };
  const save = async () => {
    setError('');
    if (!changes.length) return;
    if (needNote && !form.note.trim()) {
      setNoteError(noteMessage);
      noteRef.current?.focus();
      return;
    }
    setNoteError('');
    const body: Parameters<typeof triage.mutateAsync>[0] = { expected_updated_at: req.updated_at ?? '' };
    if (form.status !== base.status) body.status = form.status;
    if (form.priority !== base.priority) body.priority = form.priority;
    if (form.complexity !== base.complexity) body.complexity = form.complexity;
    if (form.duplicate !== base.duplicate) body.duplicate_of = form.duplicate === NONE ? null : form.duplicate;
    if (form.note.trim()) body.note = form.note.trim();
    if (declining) body.decline_reason = form.note.trim();
    try {
      await triage.mutateAsync(body);
      toast.show('Saved', { tone: 'success' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale') setError('Someone else changed this request. Reload to see their changes.');
      else if (e instanceof ApiError && e.code === 'has_duplicates') setError('Move its duplicates first.');
      else if (e instanceof ApiError && e.code === 'duplicate_chain') setError('That request is itself a duplicate. Pick the original.');
      else setError(e instanceof ApiError && e.detail ? e.detail : 'Couldn’t save. Nothing was changed.');
    }
  };
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  return (
    <Card
      as="section"
      aria-label="Triage"
      data-testid="triage"
      header={
        <div className={styles.railHead}>
          <Text variant="md">Triage</Text>
          <Tag kind="accent">Admin</Tag>
        </div>
      }
      footer={
        <div className={styles.footActions}>
          <Button variant="ghost" isDisabled={!changes.length && !form.note} onPress={reset}>
            Reset
          </Button>
          <Button variant="accent" isDisabled={!changes.length} loading={triage.isPending} onPress={() => void save()}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className={styles.triageBody}>
        {error ? (
          <p className={styles.triageError} role="alert">
            {error}{' '}
            {error.startsWith('Someone') ? (
              <Button size="sm" variant="ghost" onPress={() => window.location.reload()}>
                Reload
              </Button>
            ) : null}
          </p>
        ) : null}
        <Select label="Status" items={STATUSES} value={form.status} onChange={(k) => k && set({ status: k as FeedbackStatus })} />
        <div className={styles.pair}>
          <Select label="Priority" items={PRIORITIES} value={form.priority} onChange={(k) => k && set({ priority: k as FeedbackPriority })} />
          <Select
            label="Complexity"
            items={COMPLEXITY_ITEMS}
            value={form.complexity}
            onChange={(k) => k && set({ complexity: k as FeedbackComplexity })}
          />
        </div>
        <Select
          label="Duplicate of"
          items={dupItems}
          value={form.duplicate}
          onChange={(k) => k && set({ duplicate: String(k) })}
          searchable="auto"
        />
        {changes.length ? (
          <p className={styles.pending} data-testid="pending-changes">
            <Eyebrow>Pending</Eyebrow>
            {changes.join(' · ')}
          </p>
        ) : null}
        <Textarea
          ref={noteRef}
          label="Note for the history"
          rows={3}
          value={form.note}
          onChange={(note) => {
            set({ note });
            if (note.trim()) setNoteError('');
          }}
          isRequired={needNote}
          errorMessage={noteError || undefined}
        />
      </div>
    </Card>
  );
}
