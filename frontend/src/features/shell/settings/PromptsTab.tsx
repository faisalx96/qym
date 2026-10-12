import { useEffect, useMemo, useState } from 'react';
import { useAnalysisPrompts, useSavePrompt } from '@/api/projectSettings';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Skeleton,
  Stack,
  Tag,
  Text,
  Textarea,
  useToast,
} from '@/ui';
import { useProjectContext } from '../ProjectContext';
import styles from './settings.module.css';

const LABELS: Record<string, string> = {
  llm_analyzer: 'LLM analyzer',
  aggregator: 'Aggregator',
  rules_writer: 'Rules writer',
};

function relative(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** Word-level LCS diff, capped so huge prompts stay cheap (project_settings.html 24 000 cells). */
export function wordDiff(
  a: string,
  b: string,
  cap = 24_000,
): { kind: 'same' | 'add' | 'del'; text: string }[] {
  const x = a.split(/(\s+)/);
  const y = b.split(/(\s+)/);
  if (x.length * y.length > cap)
    return [
      { kind: 'del', text: a },
      { kind: 'add', text: b },
    ];
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: { kind: 'same' | 'add' | 'del'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push({ kind: 'same', text: x[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ kind: 'del', text: x[i++]! });
    else out.push({ kind: 'add', text: y[j++]! });
  }
  while (i < x.length) out.push({ kind: 'del', text: x[i++]! });
  while (j < y.length) out.push({ kind: 'add', text: y[j++]! });
  return out;
}

export function PromptsTab() {
  const { project, readOnly } = useProjectContext();
  const prompts = useAnalysisPrompts(project.id, true);
  const showSkeleton = useDelayedPending(prompts.isPending);
  const save = useSavePrompt(project.id);
  const toast = useToast();
  const keys = useMemo(
    () => Object.keys(prompts.data?.defaults ?? prompts.data?.prompts ?? {}),
    [prompts.data],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const key = selected ?? keys[0] ?? null;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [showDiff, setShowDiff] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  if (prompts.isError)
    return (
      <ErrorState
        error={prompts.error}
        title="Couldn’t load prompts"
        onRetry={() => prompts.refetch()}
        compact
      />
    );
  if (prompts.isPending || !key) return showSkeleton ? <Skeleton kind="lines" rows={6} /> : null;

  const current = prompts.data.prompts[key] ?? '';
  const shipped = prompts.data.defaults[key] ?? '';
  const draft = drafts[key] ?? current;
  const dirty = draft !== current;
  const isCustom = current !== shipped;

  async function persist(value: string) {
    try {
      await save.mutateAsync({ key: key!, value });
      setDrafts((d) => {
        const next = { ...d };
        delete next[key!];
        return next;
      });
      toast.show('Prompt saved', { tone: 'success' });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || 'Could not save' : 'Could not save', { tone: 'error' });
    }
  }

  return (
    <div className={styles.promptLayout} data-prompts>
      <div className={styles.promptRail} role="tablist" aria-label="Prompts" aria-orientation="vertical">
        {keys.map((k, idx) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === key}
            aria-controls={`prompt-panel-${k}`}
            tabIndex={k === key ? 0 : -1}
            className={styles.promptTab}
            onClick={() => setSelected(k)}
            onKeyDown={(e) => {
              const move = (d: number) => setSelected(keys[(idx + d + keys.length) % keys.length]!);
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') move(1);
              else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') move(-1);
              else if (e.key === 'Home') setSelected(keys[0]!);
              else if (e.key === 'End') setSelected(keys[keys.length - 1]!);
              else return;
              e.preventDefault();
            }}
          >
            <span>{LABELS[k] ?? k}</span>
            {(prompts.data.prompts[k] ?? '') !== (prompts.data.defaults[k] ?? '') ? (
              <Tag kind="accent">custom</Tag>
            ) : (
              <Tag>default</Tag>
            )}
          </button>
        ))}
      </div>
      <Stack gap="md" id={`prompt-panel-${key}`} role="tabpanel" aria-label={LABELS[key] ?? key}>
        <Textarea
          label={`${LABELS[key] ?? key} prompt`}
          value={draft}
          onChange={(v) => setDrafts((d) => ({ ...d, [key]: v }))}
          rows={14}
          mono
          className={styles.promptEditor}
          isReadOnly={readOnly}
        />
        <div className={styles.promptMeta}>
          <span>{draft.length.toLocaleString()} characters</span>
          <span>edited {relative(prompts.data.updated_at, now)}</span>
          {dirty ? <span className={styles.unsaved}>● Unsaved changes</span> : null}
          {isCustom ? <Tag kind="accent">custom</Tag> : <Tag>default</Tag>}
        </div>
        {!readOnly ? (
          <Stack direction="row" gap="sm">
            <Button
              variant="primary"
              isDisabled={!dirty}
              loading={save.isPending}
              onPress={() => persist(draft)}
            >
              Save
            </Button>
            <Button
              variant="neutral"
              isDisabled={!dirty}
              onPress={() => setDrafts((d) => ({ ...d, [key]: current }))}
            >
              Discard
            </Button>
            <Button variant="neutral" isDisabled={!isCustom && !dirty} onPress={() => setShowDiff(true)}>
              View diff
            </Button>
            <Button variant="danger" isDisabled={!isCustom} onPress={() => setConfirmRestore(true)}>
              Restore default
            </Button>
          </Stack>
        ) : null}
        <Dialog
          open={showDiff}
          onOpenChange={setShowDiff}
          title={`${LABELS[key] ?? key}: changes vs shipped default`}
          size="data"
        >
          <Text variant="sm">Deleted words are red, added words are green.</Text>
          <div className={styles.diff}>
            {wordDiff(shipped, draft).map((part, i) =>
              part.kind === 'same' ? (
                <span key={i}>{part.text}</span>
              ) : part.kind === 'add' ? (
                <ins key={i}>{part.text}</ins>
              ) : (
                <del key={i}>{part.text}</del>
              ),
            )}
          </div>
        </Dialog>
        <ConfirmDialog
          open={confirmRestore}
          onOpenChange={setConfirmRestore}
          title="Restore the shipped default?"
          tone="danger"
          description="Your customised prompt is replaced by the default that ships with qym."
          confirmLabel="Restore default"
          onConfirm={() => persist(shipped)}
        />
      </Stack>
    </div>
  );
}
