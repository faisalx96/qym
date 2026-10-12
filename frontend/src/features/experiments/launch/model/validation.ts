/**
 * Client-side checks (mirroring the vanilla form) and the mapping of server errors to
 * human field labels, wizard steps and focusable field names. The server dry run stays
 * the authority: these only cover the cheap checks.
 */
import { datasetValue, DESCRIPTION_MAX, PRIORITY_ORDER } from './document';
import { envsMissing, envName, leafSchema, notInEnvMessage } from './descriptor';
import { evaluatorLocalErrors, configEntry } from './evaluator';
import { groupOfPointer } from './settingsTree';
import { matchTemplate, pointerToFieldName, splitPointer, unescapeSegment } from './pointers';
import { parseVersioning, buildSpec } from './spec';
import { jobEstimate, sweepLocalErrors } from './sweeps';
import type {
  DryRunResponse,
  FormContext,
  LaunchDocument,
  Priority,
  ServerError,
  StepId,
  ValidationItem,
} from './types';

export const ROLE_LABELS: Record<string, string> = {
  model: 'Model',
  base_url: 'Base URL',
  api_key: 'API key',
};

// Pseudo pointers of fields that are not part of the §8.1 document.
export const PSEUDO = {
  environments: '#environments',
  name: '#name',
  base: '#base',
  versioning: '#versioning-details',
  description: '#description',
  rawJson: '#advanced-json',
} as const;

interface Located {
  label: string;
  stepId: StepId;
  groupId?: string;
}

function titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Breadcrumb of an env_overrides pointer from the descriptor labels ("Endpoints › primary › Timeout"). */
function overridesLabel(ctx: FormContext, relative: string): string {
  const fields = ctx.union.fields;
  const segs = splitPointer(relative);
  const parts: string[] = [];
  for (let i = 1; i <= segs.length; i += 1) {
    const prefix =
      '/' +
      segs
        .slice(0, i)
        .map((s) => s.replace(/~/g, '~0').replace(/\//g, '~1'))
        .join('/');
    const template = matchTemplate(fields, prefix);
    const entry = template ? fields[template] : undefined;
    const last = entry?.path[entry.path.length - 1] ?? '';
    const concrete = segs[i - 1] as string;
    if (!entry) parts.push(concrete);
    else if (last.startsWith('{') && last.endsWith('}')) parts.push(concrete);
    else parts.push(entry.label || entry.name);
  }
  return parts.slice(-3).join(' › ');
}

/** Human label, wizard step and group for a document pointer. */
export function locate(pointer: string, ctx: FormContext): Located {
  if (pointer === PSEUDO.environments) return { label: 'Environments', stepId: 'where' };
  if (pointer === PSEUDO.name) return { label: 'Name', stepId: 'where' };
  if (pointer === PSEUDO.description) return { label: 'Description', stepId: 'where' };
  if (pointer === PSEUDO.versioning) return { label: 'Versioning details', stepId: 'where' };
  if (pointer === PSEUDO.base) return { label: 'Starting point', stepId: 'start' };
  if (pointer === PSEUDO.rawJson) return { label: 'Raw JSON', stepId: 'review' };
  if (pointer === '' || pointer == null) return { label: 'Configuration', stepId: 'review' };
  if (pointer === '/evaluator/dataset') return { label: 'Dataset', stepId: 'where' };
  if (pointer === '/evaluator/dataset_version') return { label: 'Dataset version', stepId: 'where' };
  if (pointer === '/evaluator') return { label: 'Evaluation inputs', stepId: 'where' };
  if (pointer === '/links' || pointer.startsWith('/links/'))
    return { label: 'Sweeps › linked values', stepId: 'env' };
  if (pointer.startsWith('/slot_bindings')) {
    const segs = splitPointer(pointer);
    const key = segs[1];
    const slot = key ? ctx.slots.find((s) => s.slot_key === key) : undefined;
    const base = slot?.label ?? key ?? 'Models';
    const rest = segs.slice(2);
    let label = base;
    if (rest[0] === 'sweep' && rest[1] != null) label = `${base} › model ${Number(rest[1]) + 1}`;
    else if (rest[0] === 'temporary' && rest[1])
      label = `${base} › ${ROLE_LABELS[rest[1]] ?? titleCase(rest[1].replace(/_/g, ' '))}`;
    else if (rest[0] === 'connection_id') label = `${base} › Project model`;
    return { label, stepId: 'models' };
  }
  if (pointer.startsWith('/evaluator/')) {
    const segs = splitPointer(pointer);
    if (segs[1] === 'config' && segs[2]) {
      if (segs[2] === 'run_metadata') {
        return { label: segs[3] ? `Run metadata › ${segs[3]}` : 'Run metadata', stepId: 'eval' };
      }
      const entry = configEntry(ctx.evaluatorPanel, segs[2]);
      return { label: `Evaluation inputs › ${entry?.label || segs[2]}`, stepId: 'eval' };
    }
    if (segs[1] === 'report_k') return { label: 'Evaluation inputs › Report K', stepId: 'eval' };
    return { label: `Evaluation › ${segs.slice(1).join(' › ')}`, stepId: 'eval' };
  }
  if (pointer.startsWith('/env_overrides')) {
    const relative = pointer.slice('/env_overrides'.length);
    const groupId = groupOfPointer(ctx, relative) ?? undefined;
    // A field a slot fills: "Primary model › Model".
    for (const slot of ctx.slots) {
      const role = Object.keys(slot.field_map).find((r) => slot.field_map[r] === relative);
      if (role) return { label: `${slot.label} › ${ROLE_LABELS[role] ?? role}`, stepId: 'env', groupId };
    }
    return { label: overridesLabel(ctx, relative) || 'Environment overrides', stepId: 'env', groupId };
  }
  return { label: unescapeSegment(pointer), stepId: 'review' };
}

function item(
  pointer: string,
  message: string,
  ctx: FormContext,
  extra: Partial<ValidationItem> & { source: ValidationItem['source'] },
): ValidationItem {
  const where = locate(pointer, ctx);
  return {
    pointer,
    label: where.label,
    message,
    stepId: where.stepId,
    fieldName: pointerToFieldName(pointer),
    groupId: where.groupId,
    where: [],
    ...extra,
  };
}

/** Builds a validation item for a pointer (used by the default-preset editor's own checks). */
export { item as validationItem };

// ── Local errors ─────────────────────────────────────────────────────────

export interface LocalErrorOptions {
  /** Errors of the Raw JSON editor that were not applied. */
  rawJsonErrors?: ReadonlyArray<{ message: string }>;
}

/** Cheap checks, in the order the form shows them. Launch is blocked while any remain. */
export function localErrors(
  doc: LaunchDocument,
  ctx: FormContext,
  options: LocalErrorOptions = {},
): ValidationItem[] {
  const out: ValidationItem[] = [];
  const push = (pointer: string, message: string, extra: Partial<ValidationItem> = {}) =>
    out.push(item(pointer, message, ctx, { source: 'local', ...extra }));
  if (!doc.environmentIds.length) push(PSEUDO.environments, 'Pick at least one environment.');
  for (const env of ctx.envs) if (env.formError) push(PSEUDO.environments, `${env.formError} (${env.name})`);
  if (
    (doc.base.kind === 'default' || doc.base.kind === 'saved') &&
    !(doc.base.loaded && doc.base.versionId)
  ) {
    push(
      PSEUDO.base,
      doc.base.loading
        ? 'The starting point is still loading.'
        : doc.base.error || 'The starting point did not load; pick another one.',
    );
  }
  if (!datasetValue(doc)) push('/evaluator/dataset', 'Choose a dataset.');
  for (const p of Object.keys(doc.invalid))
    push('/env_overrides' + p, (doc.invalid[p] as { message: string }).message);
  for (const p of Object.keys(doc.values)) {
    for (const id of envsMissing(ctx.envs, p)) {
      push('/env_overrides' + p, notInEnvMessage(p, envName(ctx, id)), {
        rule: 'not_in_environment',
        environmentId: id,
      });
    }
  }
  // Type and bounds from the descriptor (swept values item by item).
  for (const p of Object.keys(doc.values)) {
    if (p in doc.invalid) continue;
    const template = matchTemplate(ctx.union.fields, p);
    const entry = template ? ctx.union.fields[template] : undefined;
    if (
      !entry ||
      entry.kind !== 'field' ||
      ctx.slots.some((s) => doc.bindings[s.slot_key] && s.pointers.includes(p))
    )
      continue;
    const result = leafSchema(entry).safeParse(doc.values[p]);
    if (!result.success) {
      const first = result.error.issues[0];
      const path = (first?.path ?? []).length ? '/' + (first?.path ?? []).join('/') : '';
      push('/env_overrides' + p + path, first?.message ?? 'Invalid value', { rule: 'type' });
    }
  }
  if (!doc.name.trim()) push(PSEUDO.name, 'Name the experiment.');
  if (doc.description.length > DESCRIPTION_MAX)
    push(PSEUDO.description, `Descriptions are at most ${DESCRIPTION_MAX} characters.`);
  for (const message of parseVersioning(doc.versioningText).errors) push(PSEUDO.versioning, message);
  for (const e of evaluatorLocalErrors(doc, ctx.evaluatorPanel)) push(e.pointer, e.message);
  const spec = buildSpec(doc, ctx.evaluatorPanel);
  for (const e of sweepLocalErrors(spec, (p) => locate(p, ctx).label)) push(e.pointer, e.message);
  const raw = options.rawJsonErrors ?? [];
  if (raw.length) {
    push(
      PSEUDO.rawJson,
      `Raw JSON not applied: ${raw[0]?.message}${raw.length > 1 ? ` (+${raw.length - 1} more)` : ''}`,
    );
  }
  return out;
}

// ── Server errors ────────────────────────────────────────────────────────

/** Display name of a swept combination: the dry-run job's label, else "combination n". */
function comboName(e: ServerError, preview: DryRunResponse | null | undefined): string | null {
  if (e.combo_index == null || !preview || !(preview.combo_count && preview.combo_count > 1)) return null;
  const job = (preview.jobs ?? []).find((j) => j.combo_index === e.combo_index && j.label);
  return job?.label ?? `combination ${e.combo_index + 1}`;
}

/**
 * Dry-run / launch `detail.errors` -> items with a human field label (the pointer stays
 * as secondary text), the step they belong to, and the field to focus.
 */
export function mapServerErrors(
  errors: readonly ServerError[],
  _doc: LaunchDocument,
  ctx: FormContext,
  preview?: DryRunResponse | null,
): ValidationItem[] {
  return errors.map((e) => {
    // A binding error points at the slot, whatever raw field it came from.
    const pointer =
      e.slot_key && !e.pointer.startsWith('/slot_bindings')
        ? '/slot_bindings/' + e.slot_key.replace(/~/g, '~0').replace(/\//g, '~1')
        : (e.pointer ?? '');
    const where: string[] = [];
    if (e.environment_id && ctx.envs.length > 1) where.push(envName(ctx, e.environment_id));
    const combo = comboName(e, preview);
    if (combo) where.push(combo);
    return item(pointer, e.message || 'Invalid value', ctx, {
      source: 'server',
      rule: e.rule,
      environmentId: e.environment_id ?? null,
      comboIndex: e.combo_index ?? null,
      where,
    });
  });
}

/** Server errors worth listing: not already a local error, not the cap (the callout says it), deduped. */
export function visibleServerErrors(
  source: readonly ServerError[],
  local: readonly ValidationItem[],
): ServerError[] {
  const localPointers = new Set(local.map((l) => l.pointer));
  const seen = new Set<string>();
  return source.filter((e) => {
    if (localPointers.has(e.pointer)) return false;
    if (e.rule === 'sweep_cap') return false;
    const key = [e.pointer, e.message, e.environment_id].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Everything the validation list shows: local first, then the server's. */
export function validationItems(
  doc: LaunchDocument,
  ctx: FormContext,
  server: { errors: readonly ServerError[]; preview?: DryRunResponse | null },
  options: LocalErrorOptions = {},
): ValidationItem[] {
  const local = localErrors(doc, ctx, options);
  return [...local, ...mapServerErrors(visibleServerErrors(server.errors, local), doc, ctx, server.preview)];
}

// ── Launch state ─────────────────────────────────────────────────────────

export interface RunCount {
  runs: number;
  cap: number | null;
  over: boolean;
}

/** Runs this launch creates: the dry run's count, or the local estimate while it runs. */
export function runCount(
  doc: LaunchDocument,
  ctx: FormContext,
  preview: DryRunResponse | null | undefined,
  previewLoading = false,
): RunCount {
  const estimate = jobEstimate(buildSpec(doc, ctx.evaluatorPanel), doc.environmentIds.length);
  const cap = preview?.max_jobs ?? ctx.maxJobs;
  const runs = preview && !previewLoading && preview.job_count != null ? preview.job_count : estimate;
  return { runs, cap: cap ?? null, over: cap != null && (estimate > cap || runs > cap) };
}

export interface ReviewState {
  status: string;
  canLaunch: boolean;
  items: ValidationItem[];
  count: RunCount;
}

/** The review panel's status line and whether Launch is enabled. */
export function reviewState(args: {
  doc: LaunchDocument;
  ctx: FormContext;
  preview?: DryRunResponse | null;
  previewLoading?: boolean;
  previewError?: string;
  launchErrors?: readonly ServerError[] | null;
  launching?: boolean;
  rawJsonErrors?: ReadonlyArray<{ message: string }>;
}): ReviewState {
  const { doc, ctx, preview, previewLoading, previewError, launchErrors, launching } = args;
  const items = validationItems(
    doc,
    ctx,
    { errors: launchErrors ?? preview?.errors ?? [], preview },
    { rawJsonErrors: args.rawJsonErrors },
  );
  const count = runCount(doc, ctx, preview, previewLoading);
  let status = '';
  if (!doc.environmentIds.length) status = 'Pick an environment to review.';
  else if (previewLoading) status = 'Checking…';
  else if (previewError) status = previewError;
  else if (count.over) status = 'Over the run limit';
  else if (items.length) status = `${items.length} problem${items.length === 1 ? '' : 's'} to fix`;
  else if (preview) status = 'Ready to launch';
  return { status, canLaunch: !launching && doc.environmentIds.length > 0 && !count.over, items, count };
}

/** Launch button text. */
export function launchLabel(runs: number, launching: boolean): string {
  return launching ? 'Launching…' : runs > 1 ? `Launch ${runs} runs` : 'Launch';
}

// ── Priority ─────────────────────────────────────────────────────────────

export function maxPriority(ctx: Pick<FormContext, 'envs'>): Priority {
  if (!ctx.envs.length) return 'HIGH';
  return ctx.envs
    .map((e) => e.maxPriority ?? 'NORMAL')
    .reduce((a, b) => (PRIORITY_ORDER[a] <= PRIORITY_ORDER[b] ? a : b));
}

export function priorityOptions(
  ctx: Pick<FormContext, 'envs' | 'isManager'>,
): Array<{ value: Priority | ''; label: string; disabled: boolean }> {
  const cap = maxPriority(ctx);
  const defaults = ctx.envs.map((e) => e.defaultPriority).filter((p): p is Priority => Boolean(p));
  const defaultLabel = defaults.length
    ? ` (${defaults.reduce((a, b) => (PRIORITY_ORDER[a] <= PRIORITY_ORDER[b] ? a : b))})`
    : '';
  const options: Array<{ value: Priority | ''; label: string; disabled: boolean }> = [
    { value: '', label: `Environment default${defaultLabel}`, disabled: false },
  ];
  for (const p of ['LOW', 'NORMAL', 'HIGH'] as const) {
    const overCap = PRIORITY_ORDER[p] > PRIORITY_ORDER[cap];
    const gated = p === 'HIGH' && !ctx.isManager;
    options.push({
      value: p,
      label: p + (gated ? ' (managers only)' : overCap ? ' (above the environment maximum)' : ''),
      disabled: overCap || gated,
    });
  }
  return options;
}

/** Clears a priority the selected environments / the user's role no longer allow. */
export function normalizePriority(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'envs' | 'isManager'>,
): LaunchDocument {
  if (!doc.priority) return doc;
  const over = PRIORITY_ORDER[doc.priority] > PRIORITY_ORDER[maxPriority(ctx)];
  if (over || (doc.priority === 'HIGH' && !ctx.isManager)) return { ...doc, priority: '' };
  return doc;
}

/** Warning lines for HIGH priority (the dry run's, else one per environment). */
export function highWarnings(ctx: Pick<FormContext, 'envs'>, preview?: DryRunResponse | null): string[] {
  if (preview?.preemption_warning) return [preview.preemption_warning];
  return ctx.envs.map((e) => `Launching at HIGH preempts other jobs on ${e.name}.`);
}

// ── Launch failure ───────────────────────────────────────────────────────

export const PREEMPTION_ACK_REQUIRED = 'preemption_acknowledgement_required';

export type LaunchFailure =
  | { kind: 'preemption'; message: string }
  | { kind: 'validation'; message: string; errors: ServerError[] }
  | { kind: 'other'; message: string };

/** Reads the error body of a failed POST /experiments. */
export function parseLaunchFailure(status: number, data: unknown): LaunchFailure {
  const detail = (data as { detail?: unknown } | null)?.detail;
  const message = errorMessage(detail, 'Failed to launch the experiment');
  if (status === 422 && detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as { code?: string; errors?: unknown };
    if (d.code === PREEMPTION_ACK_REQUIRED) return { kind: 'preemption', message };
    if (Array.isArray(d.errors)) return { kind: 'validation', message, errors: d.errors as ServerError[] };
  }
  return { kind: 'other', message };
}

export function errorMessage(detail: unknown, fallback = 'Request failed'): string {
  if (typeof detail === 'string' && detail) return detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  if (Array.isArray(detail))
    return detail
      .map((e) =>
        e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg) : String(e),
      )
      .join('; ');
  return fallback;
}
