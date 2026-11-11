/**
 * Swept settings in the review (round 10, point 2): one run-table column per swept pointer, named as the form names it,
 * and the values the user picked (a connection's name, never a platform abbreviation). Pure; the review step renders it.
 */

/** What the review needs of an axis: the dry run's `axes[i]` or the local `axesOf(...).axes[i]`. */
export interface SweepAxisLike {
  pointers: readonly string[];
  linked: boolean;
  /** `values[step][member]` (the dry run's axes; absent on local axes). */
  values?: readonly (readonly unknown[])[];
}

export interface SweepColumn {
  pointer: string;
  /** The setting's name: the last " › " segment of the form label ("Endpoints › primary › Timeout" -> "Timeout"). */
  name: string;
  /** The rest of the label, only when two drawn columns share the name ("Endpoints › primary"). */
  section?: string;
  /** The accessible name: the name, plus the section in parentheses when there is one. */
  label: string;
  /** The band over a linked axis's members. */
  group?: string;
  /** Numbers and booleans are mono; text and model names are sans. */
  mono: boolean;
  /** Index of the axis in `axes`. */
  axis: number;
}

export const LINKED_GROUP = 'Linked: vary together';
const SEP = ' › ';

function splitLabel(label: string): { name: string; section: string } {
  const parts = label.split(SEP);
  const name = parts.pop() ?? label;
  return { name: name || label, section: parts.join(SEP) };
}

function isScalarMono(value: unknown): boolean {
  return typeof value === 'number' || typeof value === 'boolean';
}

/** One column per swept pointer in axis order (a linked axis gives one per member, in its pointer order). */
export function sweepColumns(axes: readonly SweepAxisLike[], labelOf: (pointer: string) => string): SweepColumn[] {
  const raw = axes.flatMap((axis, a) =>
    axis.pointers.map((pointer, m) => {
      const { name, section } = splitLabel(labelOf(pointer));
      const values = (axis.values ?? []).map((step) => step[m]).filter((v) => v !== null && v !== undefined);
      return {
        pointer,
        name,
        fullSection: section,
        group: axis.linked && axis.pointers.length > 1 ? LINKED_GROUP : undefined,
        mono: values.length > 0 && values.every(isScalarMono),
        axis: a,
      };
    }),
  );
  const counts = new Map<string, number>();
  for (const c of raw) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  return raw.map(({ fullSection, ...c }) => {
    const section = (counts.get(c.name) ?? 0) > 1 && fullSection ? fullSection : undefined;
    return { ...c, section, label: section ? `${c.name} (${section})` : c.name };
  });
}

/**
 * A swept value as the user picked it: a model binding shows the connection's name (else its model, else its id), a
 * temporary model "temporary: <model>", `null` (or `{inherit: true}`) "inherit"; scalars as text; anything else as JSON.
 */
export function sweepValue(value: unknown, connectionName?: (id: string) => string | undefined): string {
  if (value === null || value === undefined) return 'inherit';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    if (v['inherit'] === true && Object.keys(v).length === 1) return 'inherit';
    if (typeof v['connection_id'] === 'string' && !('temporary' in v)) {
      const id = v['connection_id'];
      const name = typeof v['name'] === 'string' && v['name'] ? v['name'] : connectionName?.(id);
      return String(name || v['model'] || id);
    }
    if (v['temporary'] && typeof v['temporary'] === 'object') {
      const t = v['temporary'] as Record<string, unknown>;
      return `temporary: ${String(t['model'] ?? t['label'] ?? '')}`.trim();
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface SweepLine {
  /** The member names (one for a plain axis). */
  names: string[];
  /** `values[step][member]`, formatted. */
  values: string[][];
  /** Per member: mono values. */
  mono: boolean[];
  linked: boolean;
}

/** The Summary's "Swept settings" row: one line per axis, the names as the columns name them, the values per step. */
export function sweepLines(
  axes: readonly SweepAxisLike[],
  labelOf: (pointer: string) => string,
  connectionName?: (id: string) => string | undefined,
): SweepLine[] {
  const columns = sweepColumns(axes, labelOf);
  return axes.map((axis, a) => {
    const members = columns.filter((c) => c.axis === a);
    return {
      names: members.map((c) => c.label),
      values: (axis.values ?? []).map((step) => members.map((_, m) => sweepValue(step[m], connectionName))),
      mono: members.map((c) => c.mono),
      linked: axis.linked && axis.pointers.length > 1,
    };
  });
}

/** The Changes card's sweeps row: "Primary model + Milvus Search Threshold (linked), Timeout". */
export function sweepAxesText(axes: readonly SweepAxisLike[], labelOf: (pointer: string) => string): string {
  const columns = sweepColumns(axes, labelOf);
  return axes
    .map((axis, a) => {
      const names = columns.filter((c) => c.axis === a).map((c) => c.label);
      return axis.linked && names.length > 1 ? `${names.join(' + ')} (linked)` : names.join(' + ');
    })
    .join(', ');
}
