/**
 * The latency-sensitive launch gate (owner decision D4), mirrored from the server so the form never
 * learns it from a failed request (spec-b B5-21, B5-29). Pure: nothing here reads the network.
 */
import { latencyDisabledReason } from '../copy';

export interface GateEnv {
  id: string;
  name: string;
  /** `manager`: only project managers and admins may launch latency-sensitive runs here. */
  latencyMinRole?: 'member' | 'manager';
}

export interface LatencyGate {
  /** A non-manager, and every selected environment is managers-only: the box cannot be ticked. */
  disabled: boolean;
  /** Why it is disabled (`null` otherwise). */
  reason: string | null;
  /** Names of the selected managers-only environments (empty for a manager), in selection order. */
  managerOnly: string[];
}

/** The gate for `selectedIds` out of `envs` (ids that are not in `envs` are ignored). */
export function latencyGate(
  envs: readonly GateEnv[],
  canManage: boolean,
  selectedIds: readonly string[],
): LatencyGate {
  if (canManage) return { disabled: false, reason: null, managerOnly: [] };
  const selected = selectedIds
    .map((id) => envs.find((e) => e.id === id))
    .filter((e): e is GateEnv => Boolean(e));
  const managerOnly = selected.filter((e) => e.latencyMinRole === 'manager').map((e) => e.name);
  const disabled = selected.length > 0 && managerOnly.length === selected.length;
  return { disabled, reason: disabled ? latencyDisabledReason(managerOnly) : null, managerOnly };
}
