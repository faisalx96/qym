import { useEffect, useMemo, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { useAnalysisPrompts, useSavePrompt } from '@/api/projectSettings';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import {
  Button,
  ConfirmDialog,
  Dialog,
  ErrorState,
  Icon,
  Skeleton,
  Tag,
  Text,
  Textarea,
  useToast,
  type IconName,
} from '@/ui';
import { wordDiff as boundedWordDiff, type DiffOp } from '@/features/datasets/lib/wordDiff';
import { useProjectContext } from '../ProjectContext';
import styles from './settings.module.css';
import { SaveFooter, SettingsCard } from './SettingsCard';

/** Each prompt type: its name, one line on what it does, and an icon (the old settings page's list, round 10). */
const PROMPT_TYPES: Record<string, { label: string; description: string; icon: IconName }> = {
  llm_analyzer: {
    label: 'LLM analyzer',
    description: 'Diagnoses why an item got its result for a metric.',
    icon: 'sparkles',
  },
  aggregator: {
    label: 'Aggregator',
    description: 'Merges root-cause labels that name the same diagnosis.',
    icon: 'chain',
  },
  rules_writer: {
    label: 'Rules writer',
    description: 'Writes reusable diagnostic rules from documents and approved examples.',
    icon: 'book',
  },
};
const labelOf = (k: string) => PROMPT_TYPES[k]?.label ?? k;

/** The editor grows with the prompt, so most prompts show in full with no inner scroll (round 11: "expand"). */
function editorRows(text: string): number {
  const lines = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 110)), 0);
  return Math.min(48, Math.max(16, lines + 1));
}

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

/**
 * Word diff of a prompt against its shipped default: the shared bounded diff, which trims the common leading and
 * trailing words first, so one changed word in a 5,000-character prompt marks one word. The old LCS gave up past
 * 24 000 cells and marked the whole prompt deleted and re-added (round 11). Past the shared budgets, both whole texts.
 */
export function wordDiff(a: string, b: string): DiffOp[] {
  return (
    boundedWordDiff(a, b) ?? [
      { kind: 'del', text: a },
      { kind: 'add', text: b },
    ]
  );
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
  // Drafts live in this component: leaving the tab, the page or the window would drop them silently.
  const anyDirty =
    !readOnly && Object.entries(drafts).some(([k, v]) => v !== (prompts.data?.prompts[k] ?? ''));
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      anyDirty &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!anyDirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [anyDirty]);
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
    <SettingsCard
      title="AI prompts"
      description="The instructions the analysis pipeline sends to the LLM. A change applies to new analysis, aggregation and rules-writer requests; saved results are not rerun."
      data-prompts
    >
      <div className={styles.promptLayout}>
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
              <span className={styles.promptIcon} aria-hidden="true">
                <Icon name={PROMPT_TYPES[k]?.icon ?? 'file'} />
              </span>
              <span className={styles.promptLabel}>{labelOf(k)}</span>
              {/* on/off: only the exception shows. A customised prompt is configuration, so the tag is purple
                  (meta); the shipped default has no tag (round 11) */}
              <span className={styles.promptState}>
                {(prompts.data.prompts[k] ?? '') !== (prompts.data.defaults[k] ?? '') ? (
                  <Tag tone="meta">custom</Tag>
                ) : null}
              </span>
              {PROMPT_TYPES[k] ? (
                <small className={styles.promptDesc}>{PROMPT_TYPES[k].description}</small>
              ) : null}
            </button>
          ))}
        </div>
        <div
          className={styles.promptPanel}
          id={`prompt-panel-${key}`}
          role="tabpanel"
          aria-label={labelOf(key)}
        >
          <div className={styles.cardHeader}>
            <div>
              <Text variant="md">{labelOf(key)}</Text>
              {PROMPT_TYPES[key] ? <Text variant="sm">{PROMPT_TYPES[key].description}</Text> : null}
            </div>
            {!readOnly ? (
              <div className={styles.cardAction}>
                <Button
                  variant="neutral"
                  icon={<Icon name="diff" size={12} />}
                  isDisabled={!isCustom && !dirty}
                  onPress={() => setShowDiff(true)}
                >
                  View diff
                </Button>
                <Button
                  variant="danger"
                  icon={<Icon name="retry" size={12} />}
                  isDisabled={!isCustom}
                  onPress={() => setConfirmRestore(true)}
                >
                  Restore default
                </Button>
              </div>
            ) : null}
          </div>
          <Textarea
            label={`${labelOf(key)} prompt`}
            hideLabel
            value={draft}
            onChange={(v) => setDrafts((d) => ({ ...d, [key]: v }))}
            rows={editorRows(draft)}
            mono
            spellCheck={false}
            quietFocus
            className={styles.promptEditor}
            isReadOnly={readOnly}
          />
          <SaveFooter
            dirty={dirty}
            saving={save.isPending}
            onSave={() => persist(draft)}
            hideSave={readOnly}
            meta={
              <>
                <span>{draft.length.toLocaleString('en-US')} characters</span>
                <span>edited {relative(prompts.data.updated_at, now)}</span>
              </>
            }
            secondary={
              <Button
                variant="neutral"
                isDisabled={!dirty}
                disabledReason="No changes to discard"
                onPress={() => setDrafts((d) => ({ ...d, [key]: current }))}
              >
                Discard
              </Button>
            }
          />
        </div>
      </div>
      <Dialog
        open={showDiff}
        onOpenChange={setShowDiff}
        title={`${labelOf(key)}: changes vs shipped default`}
        size="data"
      >
        <Text variant="sm">Deleted words are red, added words are green.</Text>
        <div
          className={styles.diff}
          ref={(el) => {
            // open on the first change, not on the top of a long prompt
            if (el)
              requestAnimationFrame(() => el.querySelector('ins, del')?.scrollIntoView({ block: 'center' }));
          }}
        >
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
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Discard unsaved changes?"
        description="A prompt has edits that are not saved."
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
      <ConfirmDialog
        open={confirmRestore}
        onOpenChange={setConfirmRestore}
        title="Restore the shipped default?"
        tone="danger"
        description="Your customised prompt is replaced by the default that ships with qym."
        confirmLabel="Restore default"
        onConfirm={() => persist(shipped)}
      />
    </SettingsCard>
  );
}
