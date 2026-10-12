/**
 * Default-preset editor logic (brief 06 §2 journey 6): pure functions, no React, no network.
 * The provider (`mode="editor"`) loads the current default preset version as the base, lays an
 * older version or a promoted configuration on top as edits, and these helpers answer what the
 * Publish button needs: what changed, what must still be rebound, what blocks publishing and
 * how a failed publish reads.
 */
import { deriveGlobalModel } from './bindings';
import { axesOf } from './sweeps';
import { baselineFrom } from './layering';
import { deepCopy, escapeSegment, stableStringify } from './pointers';
import { buildPresetConfig, buildSpec } from './spec';
import type {
  EvaluatorPanel,
  FormContext,
  LaunchConfig,
  LaunchDocument,
  PresetRemap,
  ValidationItem,
} from './types';
import { PSEUDO, validationItem } from './validation';

export const NOTES_MAX = 5000;

/** A slot of a promoted source that used a temporary model: Publish waits for a project model. */
export interface RebindItem {
  slot_key: string;
  label?: string;
  model?: string;
  base_url?: string;
}

/** GET …/eval-environments/{env}/promote-prefill */
export interface PromotePrefillResponse {
  environment_id?: string;
  source?: { kind?: string; id?: string; label?: string; [key: string]: unknown };
  config: LaunchConfig;
  remap?: PresetRemap | null;
  unbound?: RebindItem[];
  warnings?: Array<{ rule?: string; message?: string }>;
}

/** What the page needs to know about the editor session (`useLaunch().editor`). */
export interface EditorApi {
  environmentId: string;
  /** The provider is loading the base ('loading'), has it ('ready') or could not ('error'). */
  state: 'loading' | 'ready' | 'error';
  error: string;
  /** The viewer may publish the default preset (managers). */
  canPublish: boolean;
  presetId: string | null;
  /** Version the edits are compared with (null: no default preset yet). */
  currentVersion: number | null;
  nextVersion: number;
  /** `?from=vN`: the version laid on top; `?promote=`: the source's label. */
  draftLabel: string | null;
  promoted: boolean;
  /** The form equals the base (nothing to publish yet). */
  unchanged: boolean;
  rebind: RebindItem[];
  /** Notes for the base callouts: schema warnings, dropped settings, promote warnings. */
  warnings: string[];
  schemaHash: string | null;
  /** The configuration Publish would send. */
  buildConfig: () => LaunchConfig;
}

/** Stable text of the config a publish would send (compared with the base's). */
export function presetConfigKey(
  doc: LaunchDocument,
  schemaHash?: string | null,
  panel?: EvaluatorPanel | null,
): string {
  return stableStringify(buildPresetConfig(doc, schemaHash, panel));
}

/** Rebind slots that still have no project model bound. */
export function unresolvedRebind(
  rebind: readonly RebindItem[],
  doc: Pick<LaunchDocument, 'bindings'>,
): RebindItem[] {
  return rebind.filter((item) => doc.bindings[item.slot_key]?.kind !== 'connection');
}

/** Lines for the base callouts of a promoted configuration (source, dropped, invalid, warnings, unbound). */
export function promoteWarningLines(promoted: PromotePrefillResponse): string[] {
  const from = promoted.source?.label || 'The source';
  const out: string[] = [];
  for (const d of promoted.remap?.dropped ?? [])
    out.push(`${from}: ${d.label || d.pointer} was dropped (${d.message || d.reason || 'no longer supported'}).`);
  for (const e of promoted.remap?.errors ?? [])
    out.push(`${from}: ${typeof e === 'string' ? e : e.message || e.pointer || 'Invalid value'}`);
  for (const w of promoted.warnings ?? []) if (w?.message) out.push(w.message);
  for (const u of promoted.unbound ?? [])
    out.push(
      `Rebind ${u.slot_key}: it used temporary model ${u.label || u.model || u.slot_key}. Pick a project model before publishing.`,
    );
  return out;
}

/**
 * Lays a configuration on top of the current base as edits (an older version, a promoted run or
 * saved preset): its values, models, dataset and evaluator inputs replace the document's; the
 * baseline stays the current version, so the change count shows the difference.
 */
export function layerConfigAsEdits(
  doc: LaunchDocument,
  ctx: FormContext,
  config: LaunchConfig,
): LaunchDocument {
  const b = baselineFrom(config, ctx);
  const next: LaunchDocument = {
    ...doc,
    values: deepCopy(b.values),
    invalid: {},
    bindings: deepCopy(b.bindings),
    evaluatorExtra: deepCopy(b.evaluatorExtra),
    dataset: b.dataset ? { ...b.dataset } : doc.dataset,
    base: { ...doc.base, notes: [...doc.base.notes, ...b.notes] },
  };
  return deriveGlobalModel(next, ctx);
}

/** The editor's own problems (the launch checks for name and dataset do not apply). */
export function editorReviewItems(
  items: readonly ValidationItem[],
  doc: LaunchDocument,
  ctx: FormContext,
  rebind: readonly RebindItem[],
): ValidationItem[] {
  const skip = new Set<string>([PSEUDO.name, PSEUDO.description, PSEUDO.versioning, '/evaluator/dataset']);
  const kept = items.filter(
    (i) => !skip.has(i.pointer) && i.pointer !== '/links' && !i.pointer.startsWith('/links/'),
  );
  const own: ValidationItem[] = [];
  const add = (pointer: string, message: string) =>
    own.push(validationItem(pointer, message, ctx, { source: 'local' }));
  const rebinding = new Set(rebind.map((r) => r.slot_key));
  for (const key of Object.keys(doc.bindings)) {
    const b = doc.bindings[key];
    if (b && b.kind === 'temporary' && !rebinding.has(key))
      add(
        '/slot_bindings/' + escapeSegment(key),
        `Rebind ${key} to a project model: temporary models cannot be published here.`,
      );
  }
  for (const r of unresolvedRebind(rebind, doc)) {
    add(
      '/slot_bindings/' + escapeSegment(r.slot_key),
      `Pick a project model for ${r.slot_key}: the source used temporary model ${r.label || r.model || r.slot_key}.`,
    );
  }
  const spec = buildSpec(doc, ctx.evaluatorPanel);
  if (spec.links || axesOf(spec).axes.length)
    add(PSEUDO.rawJson, 'Sweeps are not allowed here: a default preset is one configuration.');
  return [...kept, ...own];
}

export interface PublishGate {
  /** The base finished loading. */
  loaded: boolean;
  problems: number;
  /** A current version exists, so an unchanged form has nothing to publish. */
  requireChange: boolean;
  unchanged: boolean;
  baseLabel: string;
  notes: string;
  saving?: boolean;
}

/** Why Publish is disabled ('' when it is not). */
export function publishBlocker(g: PublishGate): string {
  if (!g.loaded) return 'Loading…';
  if (g.problems) return `${g.problems} problem${g.problems === 1 ? '' : 's'} to fix`;
  if (g.requireChange && g.unchanged) return `No changes from ${g.baseLabel} yet.`;
  if (!g.notes.trim()) return 'Release notes are required.';
  if (g.notes.length > NOTES_MAX) return `Release notes are at most ${NOTES_MAX} characters.`;
  return '';
}

export type PublishOutcome =
  | { kind: 'ok'; version: number; warnings: number }
  | { kind: 'forbidden'; message: string }
  | { kind: 'conflict'; message: string }
  | { kind: 'invalid'; message: string; errors: Array<{ pointer?: string; message: string }> }
  | { kind: 'error'; message: string };

/** Maps a failed publish (HTTP status + parsed body) to what the editor shows. */
export function publishFailure(
  status: number,
  message: string,
  errors: Array<{ pointer?: string; message: string }>,
): PublishOutcome {
  if (status === 403)
    return { kind: 'forbidden', message: 'Only project managers publish the default preset.' };
  if (status === 409)
    return {
      kind: 'conflict',
      message: `${message || 'The default preset changed meanwhile'}. Reload the editor to see the latest version, then re-apply your edits.`,
    };
  if (status === 422 && errors.length)
    return { kind: 'invalid', message: 'The configuration is not valid', errors };
  return { kind: 'error', message: message || 'Could not publish' };
}
