/**
 * THE LAUNCH CONTRACT. Everything a section of the launch form needs comes from `useLaunch()`;
 * nothing below the page talks to the network except the helpers named here.
 *
 * Mounting (done once, by `LaunchPage`): `<LaunchProvider mode="launch" slug projectId canManage
 * readOnly initialParams onLaunched>` from `./LaunchProvider`. In unit tests wrap a section in
 * `<LaunchTestProvider>` (below) instead: it needs no QueryClient, router or network.
 *
 * ── The state ───────────────────────────────────────────────────────────────
 *  doc / setDoc(updater)   The LaunchDocument (model/types.ts). ALL edits go through
 *                          `setDoc((d) => modelFunction(d, ...))`; the updater runs once against the
 *                          latest document (also when several edits happen in one tick). Use the
 *                          model functions (setLeafInput, setBinding, startSweep, ...), never edit
 *                          fields by hand. Model functions that need the loaded environments take
 *                          `ctx`; ones that touch temporary-model keys take `secrets`.
 *  ctx                     FormContext rebuilt whenever an environment's form / slots / models or
 *                          the evaluator panel changes. `envsLoading` is true until every selected
 *                          environment's data arrived; render skeletons, not empty states, then.
 *  secrets                 The ONE SecretStore (temporary-model API keys, memory only). Cleared on
 *                          unmount and after a launch. Never put a key in the document, URL, DOM
 *                          or storage; `secrets.put(key)` returns the ref for `{ $secret }`.
 *  review                  `reviewState()` of the current document: `items` (ValidationItem: human
 *                          `label` first, `message`, secondary `pointer`, `where[]`), `count` (runs,
 *                          cap, over), `status`, `canLaunch`. `preview` is the dry run behind it.
 *  raw                     Raw JSON editor: `raw.state.text`, `raw.status` ('in-sync' | 'unapplied' |
 *                          'errors'), `raw.state.errors`, `raw.edit(text)`, `raw.apply()`,
 *                          `raw.revert()`. Errors are part of `review.items` (pointer #advanced-json).
 *
 * ── The frame ───────────────────────────────────────────────────────────────
 *  <LaunchSection id title ...>   (components/LaunchSection.tsx) the collapsible frame every section
 *                          uses: heading button, count badge, problems summary, open state.
 *  <SectionProblems id/>   The "N problems in this section" list (click focuses the field).
 *  sectionState            `{ open[id], setOpen(id, bool), toggle(id) }` for SectionId =
 *                          'models' | 'settings' | 'sweeps' | 'evaluation' | 'raw'.
 *  openSection(id)         Open a section (e.g. after "Add sweep").
 *  sectionSummary(id)      `{ changes, problems }` for the badge and the problems list.
 *  settingsUi / setSettingsUi(updater)  search, changedOnly and opened groups of the Environment
 *                          configurations card: pass `settingsUi` as the filter of
 *                          `buildSettingsView(doc, ctx, settingsUi)`. `focusIssue` opens the group.
 *
 * ── Focus ───────────────────────────────────────────────────────────────────
 *  registerField(name, el)   Register every focusable field (and a wrapper for selects) under its
 *                          RHF-safe name: `node.fieldName` (settingsTree), `pointerToFieldName(
 *                          '/slot_bindings/endpoint:primary')`, `pointerToFieldName(PSEUDO.name)` ...
 *                          Use as `ref={(el) => registerField(name, el)}`; a non-control element is
 *                          focused through its first control.
 *  focusIssue(item)        What clicking a problem does: open the section (and settings group),
 *                          clear the search, scroll with scroll-margin, focus the field; falls back
 *                          to the section heading when the pointer maps to a container.
 *  focusField(name, section?)  The same for a field name.
 *
 * ── Environments, models, base ──────────────────────────────────────────────
 *  envRecords / selectedEnvs   Active environments / the selected ones (EvalEnvironment records).
 *  toggleEnv(id, on)       Select / deselect an environment (the provider prunes, re-bases, re-previews).
 *  reloadSlots(envId?)     Call after the LLM groups were saved (SlotEditorDialog `onSaved`).
 *  loadProposal(names)     Fetch `endpoint:<name>` proposals and add them as this-experiment endpoints
 *                          (call before `setGlobalModel` for `rawEndpointNames(doc, ctx)`); resolves
 *                          with the names at least one environment could add.
 *  chooseBase(kind, ref?)  Change the starting point (confirms when edits exist, replays the ones
 *                          that fit, toasts what was dropped). `kind` is 'default' | 'saved' |
 *                          'best_run' | 'scratch' | 'clone'; `ref` (BaseRef) picks the preset / run / env.
 *                          BestRunPicker: pick a scope with `useBestRunScope/useBestRuns` (api/launch)
 *                          then `chooseBase('best_run', { runId, metric })`.
 *  baseState               `{ envId, presets, savedPresets, loading, note, label, available(kind) }`.
 *  resetAll()              "Undo all changes" (settings, models, dataset, evaluation inputs).
 *  confirm(options)        Promise-style ConfirmDialog (`if (!(await confirm({...}))) return`).
 *
 * ── Launching ───────────────────────────────────────────────────────────────
 *  launch()                Validate, confirm HIGH, POST, handle 422 (preemption confirm-and-resend,
 *                          validation errors focused), toast and navigate on success.
 *  isLaunching, flags      `flags`: initState ('loading' | 'ready' | 'error'), envsLoading,
 *                          baseLoading, hasChanges (unsaved-changes guard), canLaunchAsIs,
 *                          multiEnv, isClone, unsavedGuard() (reads refs; false right after a launch).
 *
 * Editor mode (`mode="editor"` + the provider's `editor={{ environmentId, from?, promote? }}` prop,
 * mounted by `features/environments/DefaultPresetEditorPage`): one environment, no sweeps, no
 * temporary models; the base is the environment's current default preset version
 * (`doc.base.kind === 'official-edit'`), an older version or a promoted configuration is laid on top
 * as edits. `editor` (EditorApi, model/editor.ts) carries the session (current / next version,
 * `unchanged`, `rebind` slots, `buildConfig()` for Publish); `review.items` are the editor's own
 * checks (no name / dataset / sweeps). Sections hide launch-only controls with `mode === 'launch'`;
 * `launch()` and the dry run are not used.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EvalEnvironment } from '@/api/evalCommon';
import type { Preset } from '@/api/evalEnvironments';
import type { AskOptions } from '@/features/environments/usePromiseConfirm';
import {
  buildContext,
  createDocument,
  SecretStore,
  type BaseKind,
  type EditorApi,
  type EnvData,
  type FormContext,
  type LaunchDocument,
  type ReviewState,
  type ServerError,
  type ValidationItem,
} from './model';
import { useLaunchView } from './state/useLaunchView';
import type {
  BaseRef,
  LaunchMode,
  PreviewState,
  RawApi,
  SchemaStatus,
  SectionId,
  SectionState,
  SectionSummary,
  SettingsUi,
} from './types';

export type {
  BaseRef,
  LaunchMode,
  PreviewState,
  RawApi,
  SectionId,
  SectionState,
  SectionSummary,
  SettingsUi,
};
export { SECTION_IDS, SECTION_TITLES, sectionHeadingId, sectionBodyId } from './types';

export type SetDoc = (updater: (d: LaunchDocument) => LaunchDocument) => void;

export type BaseChoice = Exclude<BaseKind, 'official-edit'>;

export interface BaseStateView {
  /** Environment whose presets / runs the starting point uses. */
  envId: string | null;
  /** All presets of that environment (official + saved). */
  presets: Preset[];
  /** Saved presets with a published version. */
  savedPresets: Preset[];
  loading: boolean;
  /** Why the form fell back to a different starting point ('' when it did not). */
  note: string;
  /** "Default preset v3", "Saved preset “x” v2", ... */
  label: string;
  available: (kind: BaseChoice) => { ok: boolean; reason?: string };
}

export interface LaunchFlags {
  initState: 'loading' | 'ready' | 'error';
  envsLoading: boolean;
  baseLoading: boolean;
  /** The document differs from an empty form (the unsaved-changes guard). */
  hasChanges: boolean;
  /** Base is a preset, the form is valid and the dry run passed: "Launch as is" is offered. */
  canLaunchAsIs: boolean;
  multiEnv: boolean;
  isClone: boolean;
  /** True while leaving the page would lose edits (false right after a successful launch). */
  unsavedGuard: () => boolean;
}

export interface LaunchContextValue {
  mode: LaunchMode;
  /** Default-preset editor session (null in launch mode): base version, rebind slots, publish config. */
  editor: EditorApi | null;
  slug: string;
  projectId: string;
  /** Archived project: nothing can be launched. */
  readOnly: boolean;
  canManage: boolean;

  doc: LaunchDocument;
  setDoc: SetDoc;
  ctx: FormContext;
  secrets: SecretStore;

  envRecords: EvalEnvironment[];
  selectedEnvs: EvalEnvironment[];
  schemaStatus: Record<string, SchemaStatus>;
  toggleEnv: (id: string, on: boolean) => void;
  reloadSlots: (envId?: string) => Promise<void>;
  loadProposal: (names: string | string[]) => Promise<string[]>;
  /** Names of the project's datasets (null while loading). */
  datasetNames: string[] | null;

  review: ReviewState;
  preview: PreviewState;
  /** Errors of the last failed launch (empty when none or when the form changed since). */
  launchErrors: ServerError[];
  raw: RawApi;

  sectionState: SectionState;
  openSection: (id: SectionId) => void;
  sectionSummary: (id: SectionId) => SectionSummary;
  settingsUi: SettingsUi;
  setSettingsUi: (updater: (ui: SettingsUi) => SettingsUi) => void;
  registerField: (name: string, el: HTMLElement | null) => void;
  focusField: (name: string, fallback?: SectionId | null) => void;
  focusIssue: (item: ValidationItem) => void;

  baseState: BaseStateView;
  chooseBase: (kind: BaseChoice, ref?: BaseRef) => Promise<boolean>;
  resetAll: () => void;
  confirm: (options: AskOptions) => Promise<boolean>;

  isLaunching: boolean;
  launch: () => Promise<void>;
  flags: LaunchFlags;
}

export const LaunchCtx = createContext<LaunchContextValue | null>(null);

/** The launch form's state. Throws outside a provider. */
export function useLaunch(): LaunchContextValue {
  const value = useContext(LaunchCtx);
  if (!value)
    throw new Error('useLaunch must be used under <LaunchProvider> (or <LaunchTestProvider> in tests)');
  return value;
}

// ── Test provider ───────────────────────────────────────────────────────────

export interface LaunchTestProviderProps {
  children: ReactNode;
  /** Initial document (default: `createDocument()` selecting the environments of `envs`). */
  doc?: LaunchDocument;
  /** Loaded environments (model `envDataFrom(...)` results). */
  envs?: EnvData[];
  datasetNames?: string[];
  canManage?: boolean;
  mode?: LaunchMode;
  preview?: Partial<PreviewState>;
  launchErrors?: ServerError[];
  /** Override any part of the value (spies for `launch`, `chooseBase`, ...). */
  overrides?: Partial<LaunchContextValue>;
}

const NOOP_ASYNC = async () => {};

/**
 * A network-free provider for unit tests of sections: a working document (`setDoc` edits it),
 * real review / raw JSON / section state, stubbed environment and launch calls.
 */
export function LaunchTestProvider({
  children,
  doc: initialDoc,
  envs = [],
  datasetNames = [],
  canManage = true,
  mode = 'launch',
  preview: previewOverride,
  launchErrors = [],
  overrides,
}: LaunchTestProviderProps) {
  const [doc, setDocState] = useState<LaunchDocument>(
    () => initialDoc ?? createDocument({ environmentIds: envs.map((e) => e.id) }),
  );
  const docRef = useRef(doc);
  const setDoc = useCallback<SetDoc>((updater) => {
    docRef.current = updater(docRef.current);
    setDocState(docRef.current);
  }, []);
  const [secrets] = useState(() => new SecretStore());
  const ctx = useMemo(
    () => buildContext({ envs, extraEndpoints: doc.extraEndpoints, datasetNames, isManager: canManage }),
    [envs, doc.extraEndpoints, datasetNames, canManage],
  );
  const preview = useMemo<PreviewState>(
    () => ({ data: null, loading: false, error: '', ...previewOverride }),
    [previewOverride],
  );
  const view = useLaunchView({ doc, setDoc, ctx, secrets, preview, launchErrors, launching: false });
  const value: LaunchContextValue = {
    mode,
    editor: null,
    slug: 'test',
    projectId: 'p1',
    readOnly: false,
    canManage,
    doc,
    setDoc,
    ctx,
    secrets,
    envRecords: [],
    selectedEnvs: [],
    schemaStatus: {},
    toggleEnv: () => {},
    reloadSlots: NOOP_ASYNC,
    loadProposal: async () => [],
    datasetNames,
    review: view.review,
    preview,
    launchErrors,
    raw: view.raw,
    sectionState: view.sectionState,
    openSection: view.openSection,
    sectionSummary: view.sectionSummary,
    settingsUi: view.settingsUi,
    setSettingsUi: view.setSettingsUi,
    registerField: view.registerField,
    focusField: view.focusField,
    focusIssue: view.focusIssue,
    baseState: {
      envId: envs[0]?.id ?? null,
      presets: [],
      savedPresets: [],
      loading: false,
      note: '',
      label: 'Test base',
      available: () => ({ ok: true }),
    },
    chooseBase: async () => true,
    resetAll: () => {},
    confirm: async () => true,
    isLaunching: false,
    launch: NOOP_ASYNC,
    flags: {
      initState: 'ready',
      envsLoading: false,
      baseLoading: false,
      hasChanges: false,
      canLaunchAsIs: false,
      multiEnv: envs.length > 1,
      isClone: false,
      unsavedGuard: () => false,
    },
    ...overrides,
  };
  return <LaunchCtx.Provider value={value}>{children}</LaunchCtx.Provider>;
}
