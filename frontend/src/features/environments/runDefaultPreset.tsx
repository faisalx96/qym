/**
 * "Run default preset" one click (eval_environments.js `runOfficialDefaults`, plan §9.2):
 * a 1-job experiment on the environment with `base_source = {kind: official, preset_version_id}`
 * and the current default-preset version re-mapped onto the environment's current schema.
 * When it cannot launch as is (no dataset, remap errors, a temporary model, a missing model,
 * HIGH default for a non-manager, validation errors) the launch form opens on that environment
 * instead. HIGH asks for the preemption acknowledgement (§5.3).
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { fetchPresetVersionView, type PresetVersion, type RemapResult } from '@/api/evalEnvironments';
import { errorCode, errorList, errorMessage, type EvalEnvironment } from '@/api/evalCommon';
import { api, ApiError } from '@/lib/http';
import { useToast } from '@/ui';
import { experimentPath, launchPath } from '@/features/experiments/paths';
import { highPriorityWarning } from './format';
import { usePromiseConfirm } from './usePromiseConfirm';

export const PREEMPTION_ACK_REQUIRED = 'preemption_acknowledgement_required';

export function canRunDefaultPreset(env: EvalEnvironment | undefined | null): boolean {
  return Boolean(
    env &&
    env.is_active &&
    env.current_schema_id &&
    env.official_preset_id &&
    env.official_preset_version != null,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Why a re-mapped default-preset version cannot launch in one click (null when it can).
 * A temporary binding found here is stale data (publishing refuses them, a key is never
 * stored in a preset): the launch form opens instead, where the key can be entered.
 */
export function launchBlocker(
  envName: string,
  version: PresetVersion,
  remap: RemapResult | null | undefined,
): string | null {
  const label = `Default preset v${version.version}`;
  if (!remap || remap.ok === false || (remap.errors ?? []).length) {
    return `${label} needs changes for the current schema of “${envName}”.`;
  }
  const config = remap.config ?? {};
  const dataset = config.evaluator?.dataset;
  if (typeof dataset !== 'string' || !dataset) return `${label} does not name a dataset; pick one.`;
  const bindings = isObject(config.slot_bindings) ? config.slot_bindings : {};
  if (Object.values(bindings).some((b) => isObject(b) && b.temporary)) {
    return `${label} uses a temporary model, which needs its API key.`;
  }
  const missing = (version.warnings ?? []).find(
    (w) => w && (w.rule === 'connection_missing' || w.rule === 'connection_unavailable'),
  );
  if (missing) return missing.message || 'A model of the default preset is not available.';
  return null;
}

export interface RunDefaultPresetOptions {
  projectId: string;
  slug: string;
  canManage: boolean;
  onLaunched?: (experimentId: string) => void;
}

export function useRunDefaultPreset({ projectId, slug, canManage, onLaunched }: RunDefaultPresetOptions): {
  run: (env: EvalEnvironment) => Promise<void>;
  busyId: string | null;
  dialog: ReactNode;
} {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { ask, dialog } = usePromiseConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  const run = useCallback(
    async (env: EvalEnvironment) => {
      const review = (reason: string) => {
        toast.show(`${reason} Opening the launch form.`, { tone: 'info' });
        navigate(launchPath(slug, { env: env.id, base: 'default' }));
      };
      if (!canRunDefaultPreset(env)) {
        toast.show(`No default preset is published for “${env.name}”.`, { tone: 'error' });
        return;
      }
      setBusyId(env.id);
      try {
        let view;
        try {
          view = await fetchPresetVersionView(
            projectId,
            env.id,
            env.official_preset_id!,
            env.official_preset_version!,
            true,
          );
        } catch (error) {
          toast.show(errorMessage(error) || 'Could not load the default preset', { tone: 'error' });
          return;
        }
        const { version, remap } = view;
        const blocker = launchBlocker(env.name, version, remap);
        if (blocker || !remap) return review(blocker ?? 'The default preset could not be re-mapped.');
        if ((remap.dropped ?? []).length) {
          const ok = await ask({
            title: 'Launch the default preset?',
            description: [
              remap.summary || 'Some settings are no longer supported.',
              'Those settings keep the environment’s own values.',
            ],
            confirmLabel: 'Launch anyway',
            cancelLabel: 'Don’t launch',
          });
          if (!ok) return;
        }
        const body: Record<string, unknown> = {
          name: `${env.name} · default preset v${version.version}`.slice(0, 200),
          environment_ids: [env.id],
          spec: remap.config,
          base_source: { kind: 'official', preset_version_id: version.id },
        };
        const confirmHigh = (lines: string[]) =>
          ask({
            title: 'Launch at HIGH priority?',
            description: lines,
            confirmLabel: 'Launch at HIGH',
            cancelLabel: 'Don’t launch',
            tone: 'danger',
          });
        if (env.default_priority === 'HIGH') {
          if (!canManage)
            return review(
              `“${env.name}” launches at HIGH by default, which needs a project manager; pick a priority.`,
            );
          if (!(await confirmHigh([highPriorityWarning(env.name)]))) return;
          body.acknowledge_preemption = true;
        }
        const send = () =>
          api.post<{ id?: string }>(`/v1/projects/${encodeURIComponent(projectId)}/experiments`, body);
        let launched: { id?: string } | null = null;
        let failure: unknown = null;
        try {
          launched = await send();
        } catch (error) {
          failure = error;
        }
        if (failure && errorCode(failure) === PREEMPTION_ACK_REQUIRED) {
          if (!(await confirmHigh([errorMessage(failure) || highPriorityWarning(env.name)]))) return;
          body.acknowledge_preemption = true;
          failure = null;
          try {
            launched = await send();
          } catch (error) {
            failure = error;
          }
        }
        if (!failure && launched?.id) {
          toast.show(`Launched default preset v${version.version} on “${env.name}”`, { tone: 'success' });
          void qc.invalidateQueries({ queryKey: ['experiments'] });
          if (onLaunched) onLaunched(launched.id);
          else navigate(experimentPath(slug, launched.id));
          return;
        }
        const errors = failure instanceof ApiError && failure.status === 422 ? errorList(failure) : [];
        if (errors.length)
          return review(
            `Default preset v${version.version} does not validate: ${errors[0]!.message || 'invalid value'}.`,
          );
        toast.show(errorMessage(failure) || 'Failed to launch the default preset', { tone: 'error' });
      } finally {
        setBusyId(null);
      }
    },
    [projectId, slug, canManage, onLaunched, navigate, toast, qc, ask],
  );

  return { run, busyId, dialog };
}
