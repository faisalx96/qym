/**
 * Run labels (compare.html compareRunLabels): columns tell runs apart by model
 * and start date; when every run uses one model the label is the part of the
 * run name the runs do not share. Full names go in the title.
 */
export interface LabelInput {
  base: string;
  name: string;
  model: string;
  started: string;
}

export interface RunLabel {
  label: string;
  title: string;
}

export function modelShortName(raw: unknown): string {
  const text = String(raw ?? '').trim();
  return text ? (text.split('/').filter(Boolean).pop() ?? '') : '';
}

export function dateLabel(value: string, withTime = false, now: Date = new Date()): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString(
    'en-US',
    sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' },
  );
  return withTime ? `${date} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : date;
}

/** The distinct part of each name after the prefix they all share; null when none is worth stripping. */
export function stripSharedPrefix(names: string[]): string[] | null {
  if (names.length < 2) return null;
  let prefix = names[0] ?? '';
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  const boundary = Math.max(...['-', '_', ' ', '.', '/', ':'].map((sep) => prefix.lastIndexOf(sep)));
  const cut = boundary + 1;
  if (cut < 3) return null;
  const rests = names.map((name) => name.slice(cut).replace(/^[-_\s.,/:]+/, ''));
  return rests.every(Boolean) ? rests : null;
}

export function computeRunLabels(inputs: LabelInput[], now?: Date): Record<string, RunLabel> {
  const models = new Set(inputs.map((i) => i.model));
  let labels: string[] | null = null;
  if (models.size === 1) labels = stripSharedPrefix(inputs.map((i) => i.name));
  if (labels && new Set(labels).size !== labels.length) labels = null;
  if (!labels) {
    const byDate = inputs.map((i) =>
      [i.model || i.name, dateLabel(i.started, false, now)].filter(Boolean).join(' · '),
    );
    const withTime: string[] = inputs.map((entry, index) =>
      byDate.filter((other) => other === byDate[index]).length > 1
        ? [entry.model || entry.name, dateLabel(entry.started, true, now)].filter(Boolean).join(' · ')
        : (byDate[index] ?? ''),
    );
    const counts: Record<string, number> = {};
    labels = withTime.map((label) => {
      if (withTime.filter((other) => other === label).length < 2) return label;
      counts[label] = (counts[label] ?? 0) + 1;
      return `${label} #${counts[label]}`;
    });
  }
  const out: Record<string, RunLabel> = {};
  const finalLabels = labels;
  inputs.forEach((entry, index) => {
    out[entry.base] = {
      label: finalLabels[index] || entry.name,
      title: [entry.name, entry.model, entry.started].filter(Boolean).join(' · '),
    };
  });
  return out;
}

/**
 * The name a run goes by in the report (legacy run cards, legend and banner): the run's own `run_name` when it has one
 * that differs from the disambiguated label, else that label. A pass of a repeat run keeps its pass suffix.
 */
export function runShortName(run: {
  label: string;
  pass?: number | null;
  run?: { run_name?: string | null } | null;
}): string {
  const own = (run.run?.run_name ?? '').trim().replace(/ · pass \d+$/, '');
  const label = run.label.replace(/ · pass \d+$/, '');
  const base = own && own !== label ? own : label;
  return run.pass ? `${base} · pass ${run.pass}` : base;
}

/**
 * Round 8 (D2): the name a run goes by is its run name; two different runs that share a name get their start time
 * appended in every place the name is shown (`name · Oct 1 3:00 PM`), so a swatch + name never reads the same twice.
 * `bases` identifies the run (passes of one repeat run share it and share the name on purpose).
 */
export function disambiguateRunNames(
  entries: Array<{ base: string; name: string; started: string }>,
  now?: Date,
): string[] {
  const basesByName = new Map<string, Set<string>>();
  for (const e of entries) basesByName.set(e.name, (basesByName.get(e.name) ?? new Set()).add(e.base));
  const named = entries.map((e) => {
    if ((basesByName.get(e.name)?.size ?? 0) < 2) return e.name;
    const when = dateLabel(e.started, true, now);
    return when ? `${e.name} · ${when}` : e.name;
  });
  // Runs that started at the same minute still read the same: number them in selection order.
  const basesByLabel = new Map<string, string[]>();
  named.forEach((label, i) => {
    const list = basesByLabel.get(label) ?? [];
    if (!list.includes(entries[i]!.base)) list.push(entries[i]!.base);
    basesByLabel.set(label, list);
  });
  return named.map((label, i) => {
    const list = basesByLabel.get(label)!;
    return list.length < 2 ? label : `${label} #${list.indexOf(entries[i]!.base) + 1}`;
  });
}
