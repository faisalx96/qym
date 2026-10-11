/**
 * UI state shared by the item rows and cards (text mode, hidden metadata fields,
 * expansion) and the trace drawer, hosted once around the list and the Sweep dialog.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { getTextMode, type TextMode } from '@/lib/text';
import { useSearchParamsState } from '@/lib/url-state';
import { useCompare } from '../../CompareContext';
import { TraceDrawer } from '../rd/TraceDrawer';

export interface TraceTarget {
  /** Base run id whose trace is read. */
  runId: string;
  itemId: string;
  pass: number | null;
}

export interface ItemsUiValue {
  textMode: TextMode;
  setTextMode: (m: TextMode) => void;
  hiddenFields: Set<string>;
  setFieldHidden: (key: string, hide: boolean) => void;
  expanded: Set<string>;
  toggleExpanded: (itemId: string, open?: boolean) => void;
  openTrace: (target: TraceTarget) => void;
}

const Ctx = createContext<ItemsUiValue | null>(null);

export function useItemsUi(): ItemsUiValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useItemsUi outside <ItemsUiHost>');
  return v;
}

export function ItemsUiHost({ children }: { children: ReactNode }) {
  const { model, c } = useCompare();
  const { params, replaceUrlQuery } = useSearchParamsState();
  const [textMode, setTextMode] = useState<TextMode>(() => getTextMode());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(c.view.item ? [c.view.item] : []));

  const toggleExpanded = useCallback(
    (itemId: string, open?: boolean) => {
      const want = open ?? !expanded.has(itemId);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (want) next.add(itemId);
        else next.delete(itemId);
        return next;
      });
      // ?item= names the open item (the last one opened); closing it drops the param.
      if (want) replaceUrlQuery({ item: itemId });
      else if (c.view.item === itemId) replaceUrlQuery({ item: null });
    },
    [expanded, replaceUrlQuery, c.view.item],
  );

  // ?trace=<item_id>[&traceRun=<base run id>][&tracePass=N]
  const traceItem = params.get('trace');
  const traceRun = params.get('traceRun');
  const tracePass = parseInt(params.get('tracePass') ?? '', 10);
  const trace: TraceTarget | null = useMemo(() => {
    if (!traceItem) return null;
    if (traceRun) return { runId: traceRun, itemId: traceItem, pass: Number.isFinite(tracePass) ? tracePass : null };
    const run = model.runs.find((r) => r.byItem.get(traceItem)?.trace_id) ?? model.runs.find((r) => r.byItem.has(traceItem));
    const row = run?.byItem.get(traceItem);
    return run && row ? { runId: run.base, itemId: row.item_id, pass: run.pass } : null;
  }, [traceItem, traceRun, tracePass, model.runs]);
  const openTrace = useCallback((t: TraceTarget) => replaceUrlQuery({ trace: t.itemId, traceRun: t.runId, tracePass: t.pass }), [replaceUrlQuery]);
  const run = trace ? model.runs.find((r) => r.base === trace.runId) : null;

  const value = useMemo<ItemsUiValue>(
    () => ({
      textMode,
      setTextMode,
      hiddenFields: hidden,
      setFieldHidden: (k, hide) =>
        setHidden((h) => {
          const n = new Set(h);
          if (hide) n.add(k);
          else n.delete(k);
          return n;
        }),
      expanded,
      toggleExpanded,
      openTrace,
    }),
    [textMode, hidden, expanded, toggleExpanded, openTrace],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {trace ? (
        <TraceDrawer
          key={`${trace.runId}:${trace.itemId}:${trace.pass ?? ''}`}
          runId={trace.runId}
          itemId={trace.itemId}
          pass={trace.pass}
          langfuseHost={model.langfuseHost || run?.run.langfuse_host}
          langfuseProjectId={model.langfuseProjectId || run?.run.langfuse_project_id}
          onClose={() => replaceUrlQuery({ trace: null, traceRun: null, tracePass: null })}
        />
      ) : null}
    </Ctx.Provider>
  );
}
