/**
 * The rule list of one open draft with 700 ms autosave. Mount it with
 * `key={version.id}`: local edits are the source of truth while the draft is
 * open, so a server refresh never overwrites text being typed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSaveRules, type AnalysisScope, type RuleItem, type RuleVersion } from '@/api/analysis';
import { ApiError } from '@/lib/http';

export const AUTOSAVE_MS = 700;

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'invalid';

export interface DraftRule extends RuleItem {
  /** Stable React key for rules that have no server id yet. */
  key: string;
}

let keyCounter = 0;
const newKey = () => `r${++keyCounter}`;
const toDraft = (rules: RuleItem[]): DraftRule[] => rules.map((r) => ({ ...r, key: r.id ?? newKey() }));
export const ruleIsComplete = (r: RuleItem) => Boolean(r.title.trim() && r.instruction.trim());

export function useDraftRules(scope: AnalysisScope, version: RuleVersion, editable: boolean) {
  const [rules, setRules] = useState<DraftRule[]>(() => toDraft(version.rules ?? []));
  const rulesRef = useRef(rules);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const save = useSaveRules(scope);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionId = version.id;

  const flush = useCallback(
    (next: DraftRule[]) => {
      if (next.some((r) => !ruleIsComplete(r))) {
        setState('invalid');
        return;
      }
      setState('saving');
      save.mutate(
        { rules: next, versionId },
        {
          onSuccess: (data) => {
            // Adopt server ids for newly created rules without disturbing text being typed.
            const saved = data.analysis_rules;
            rulesRef.current = rulesRef.current.map((r, i) =>
              r.id ? r : { ...r, id: saved[i]?.id ?? r.id },
            );
            setRules(rulesRef.current);
            setState('saved');
            setError(null);
          },
          onError: (e) => {
            setState('error');
            setError(e instanceof ApiError ? e.detail || e.message : 'The draft could not be saved.');
          },
        },
      );
    },
    [save, versionId],
  );

  const change = useCallback(
    (updater: (current: DraftRule[]) => DraftRule[]) => {
      if (!editable) return;
      const next = updater(rulesRef.current);
      rulesRef.current = next;
      setRules(next);
      setState(next.some((r) => !ruleIsComplete(r)) ? 'invalid' : 'dirty');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        flush(rulesRef.current);
      }, AUTOSAVE_MS);
    },
    [editable, flush],
  );

  // A pending autosave is flushed (not dropped) when the editor unmounts or the page unloads.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => {
    const flushPending = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      if (rulesRef.current.every(ruleIsComplete)) flushRef.current(rulesRef.current);
    };
    window.addEventListener('beforeunload', flushPending);
    return () => {
      window.removeEventListener('beforeunload', flushPending);
      flushPending();
    };
  }, []);

  const actions = useMemo(
    () => ({
      update: (key: string, patch: Partial<RuleItem>) =>
        change((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r))),
      add: () => {
        const key = newKey();
        change((cur) => [{ key, title: '', instruction: '' }, ...cur]);
        return key;
      },
      remove: (keys: string[]) => change((cur) => cur.filter((r) => !keys.includes(r.key))),
    }),
    [change],
  );

  return { rules, state, error, ...actions };
}

/** Rough prompt-size hint shown beside the rule count (chars / 4). */
export function estimateTokens(rules: RuleItem[]): number {
  return Math.ceil(rules.reduce((n, r) => n + r.title.length + r.instruction.length, 0) / 4);
}
