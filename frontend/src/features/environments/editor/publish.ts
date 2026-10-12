/** Publishing the default preset: v1 creates the official preset, later versions post to it. */
import { ApiError } from '@/lib/http';
import { errorList, errorMessage } from '@/api/evalCommon';
import type { Preset, PresetConfig, PresetVersion } from '@/api/evalEnvironments';
import { publishFailure, type PublishOutcome } from '@/features/experiments/launch/model';

export const DEFAULT_PRESET_NAME = 'Default preset';

export interface PublishClient {
  create: (body: {
    kind: 'official';
    name: string;
    config: PresetConfig;
    notes: string;
  }) => Promise<{ preset: Preset; warnings?: unknown[] }>;
  publish: (
    presetId: string,
    body: { config: PresetConfig; notes: string },
  ) => Promise<{ preset?: Preset; version?: PresetVersion; warnings?: unknown[] }>;
}

/** POST …/presets (no default preset yet) or POST …/presets/{id}/versions; never throws. */
export async function runPublish(
  client: PublishClient,
  args: { presetId: string | null; config: PresetConfig; notes: string; fallbackVersion: number },
): Promise<PublishOutcome> {
  const notes = args.notes.trim();
  try {
    if (args.presetId) {
      const res = await client.publish(args.presetId, { config: args.config, notes });
      return {
        kind: 'ok',
        version: res.version?.version ?? res.preset?.current_version?.version ?? args.fallbackVersion,
        warnings: (res.warnings ?? []).length,
      };
    }
    const res = await client.create({
      kind: 'official',
      name: DEFAULT_PRESET_NAME,
      config: args.config,
      notes,
    });
    return {
      kind: 'ok',
      version: res.preset?.current_version?.version ?? args.fallbackVersion,
      warnings: (res.warnings ?? []).length,
    };
  } catch (error) {
    if (error instanceof ApiError) return publishFailure(error.status, errorMessage(error), errorList(error));
    return { kind: 'error', message: errorMessage(error) || 'Could not publish' };
  }
}
