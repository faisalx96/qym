/**
 * Consistency v3 guards (impl/spec-merged.json, one `it` per rule id).
 * Each guard stops an old pattern from coming back. They are static scans of
 * src/**, in the style of design-language.test.ts. Read docs/DESIGN_LANGUAGE.md
 * before you change a guard.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const read = (p: string) => readFileSync(p, 'utf-8');
const rel = (p: string) => relative(SRC, p).split('\\').join('/');
const all = fg.sync('**/*.{ts,tsx,css}', { cwd: SRC, absolute: true, ignore: ['**/node_modules/**'] });
const isTest = (f: string) => /__tests__\/|\.test\.tsx?$|\.stories\.tsx?$/.test(rel(f));
/** Shipped source: no tests, no stories, no dev mock gallery. */
const shipped = all.filter((f) => !isTest(f) && !rel(f).startsWith('features/dev/'));
const shippedTs = shipped.filter((f) => /\.tsx?$/.test(f));
const shippedTsx = shipped.filter((f) => f.endsWith('.tsx'));
const shippedCss = shipped.filter((f) => f.endsWith('.css'));
const under = (files: string[], ...dirs: string[]) =>
  files.filter((f) => dirs.some((d) => rel(f).startsWith(d)));
const outside = (files: string[], ...dirs: string[]) =>
  files.filter((f) => !dirs.some((d) => rel(f).startsWith(d)));

/** The one file whose path (relative to src/) ends with `suffix`. */
function path(suffix: string): string {
  const hits = all.filter((f) => rel(f) === suffix || rel(f).endsWith(`/${suffix}`));
  if (hits.length !== 1)
    throw new Error(`${suffix}: ${hits.length} files match (${hits.map(rel).join(', ')})`);
  return hits[0]!;
}
const src = (suffix: string) => read(path(suffix));
const exists = (p: string) => existsSync(join(SRC, p));

/** Every `file:line: text` in `files` where `re` matches, minus `allow` (rel paths or rel:line). */
function grep(files: string[], re: RegExp, allow: string[] = []): string[] {
  const out: string[] = [];
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (const f of files) {
    const text = read(f);
    if (allow.includes(rel(f))) continue;
    for (const m of text.matchAll(g)) {
      const line = text.slice(0, m.index).split('\n').length;
      if (allow.includes(`${rel(f)}:${line}`)) continue;
      out.push(`${rel(f)}:${line}: ${m[0].slice(0, 80)}`);
    }
  }
  return out;
}

/** Assert an empty problem list (the joined text shows every hit). */
const none = (list: string[], why?: string) =>
  expect(list, [why, ...list].filter(Boolean).join('\n')).toEqual([]);

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
/** Rule bodies whose selector list names `selector` exactly (whitespace-normalised). */
function rules(css: string, selector: string): string[] {
  const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  const want = norm(selector);
  return [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.split(',').some((s) => norm(s) === want))
    .map((m) => m[2]!);
}
const rule = (css: string, selector: string) => rules(css, selector).join('\n');
/** All [selector, body] pairs of a stylesheet. */
const allRules = (css: string) =>
  [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!] as const);

type El = { name: string; attrs: string; inner: string; text: string; line: number };
/** JSX elements named `names` (attrs parsed with brace and quote depth; inner up to the next closing tag). */
function elements(text: string, names: string[]): El[] {
  const out: El[] = [];
  const open = new RegExp(`<(${names.join('|')})(?=[\\s>/<])`, 'g');
  for (const m of text.matchAll(open)) {
    let i = m.index! + m[0].length;
    if (text[i] === '<') {
      // a generic argument: <DataTable<Row> ...>
      for (let d = 0; i < text.length; i++) {
        if (text[i] === '<') d++;
        else if (text[i] === '>' && --d === 0) break;
      }
      i++;
    }
    const attrStart = i;
    let depth = 0;
    let quote = '';
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === quote && text[i - 1] !== '\\') quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        if (depth > 0 || c === '"' || c === "'") quote = c;
      } else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const attrs = text.slice(attrStart, i);
    let inner = '';
    if (!attrs.trimEnd().endsWith('/')) {
      const close = text.indexOf(`</${m[1]}>`, i);
      inner = close < 0 ? '' : text.slice(i + 1, close);
    }
    out.push({
      name: m[1]!,
      attrs,
      inner,
      text: inner
        .replace(/<[^>]+>/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      line: text.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}
/** True when the element itself (not a nested element in a prop value) has `prop=`. */
function hasProp(attrs: string, prop: string): boolean {
  let top = '';
  let depth = 0;
  for (const c of attrs) {
    if (c === '{') depth++;
    if (depth === 0) top += c;
    if (c === '}') depth--;
  }
  return new RegExp(`(^|\\s)${prop}=`).test(top);
}
const buttons = (text: string) => elements(text, ['Button', 'LinkButton']);

/** The source of top-level function `name`, up to the next top-level declaration. */
function fnBody(text: string, name: string): string {
  const at = text.search(new RegExp(`\\b(function|const) ${name}\\b`));
  if (at < 0) return '';
  const next = text.slice(at + 1).search(/\n(export |function |const |interface |type )/);
  return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
}

/** The balanced `{...}` value of `prop=` inside `text` from `from` on. */
function propValue(text: string, prop: string, from = 0): string | null {
  const at = text.indexOf(`${prop}={`, from);
  if (at < 0) return null;
  let depth = 0;
  for (let i = at + prop.length + 1; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(at + prop.length + 2, i);
  }
  return null;
}

describe('consistency v3: family A (buttons, links, menus)', () => {
  it('A-01: there is no ghost button and no "Show all N" button; the Show button sits in the footer centre', () => {
    none(grep(shippedTsx, /variant="ghost"/));
    expect(src('ui/Button/Button.module.css')).not.toMatch(/\[data-variant=['"]ghost['"]\]/);
    const problems: string[] = [];
    for (const f of shippedTsx)
      for (const b of buttons(read(f)))
        if (/^Show all \d|more (rows|metrics)$/.test(b.text)) problems.push(`${rel(f)}:${b.line}: ${b.text}`);
    none(problems);
    expect(src('features/compare/components/rd/TraceDrawer.tsx')).not.toContain('className={styles.tool}');
    expect(src('ui/DataTable/parts.tsx')).toMatch(/\bcenter\?: ReactNode/);
    expect(src('MaintenanceTab.tsx')).toMatch(/center=\{\s*[\s\S]{0,120}?<Button/);
    // D-12: no "Show all <count>" text and no full-tree toggle in KeyTree
    none(grep(under(shippedTs, 'features/', 'ui/'), /Show all (\d|\$?\{)/));
    expect(src('KeyTree.tsx')).not.toContain('.showFull');
    // shim: Button.tsx keeps a 'ghost' alias until the cv3-shim removal
    expect(src('ui/Button/Button.tsx')).not.toContain('ghost');
  });

  it('A-02: a commit button is primary and Disable item is danger', () => {
    const commit = new Set([
      'Save',
      'Publish',
      'Make live',
      'Send',
      'Add',
      'Add model',
      'Start conversation',
      'Run backfill',
      'Create draft',
    ]);
    const problems: string[] = [];
    for (const f of shippedTsx) {
      if (rel(f) === 'features/experiments/launch/settings/SweepChips.tsx') continue;
      for (const b of buttons(read(f))) {
        if (commit.has(b.text) && !/variant="primary"/.test(b.attrs))
          problems.push(`${rel(f)}:${b.line}: ${b.text}`);
        if (/Disable item|Disable \$\{/.test(b.inner) && !/variant="danger"/.test(b.attrs))
          problems.push(`${rel(f)}:${b.line}: Disable item is not danger`);
        // E-19: a dialog Cancel is never a ghost
        if (b.text === 'Cancel' && /variant="ghost"/.test(b.attrs))
          problems.push(`${rel(f)}:${b.line}: ghost Cancel`);
      }
    }
    none(problems);
  });

  it('A-03: a row action and an icon-only delete are IconButton tiles', () => {
    const dt = src('ui/DataTable/DataTable.tsx');
    const rowIcon = elements(dt, ['IconButton']).filter((e) => /\btile\b/.test(e.attrs));
    expect(rowIcon.length, 'rowActions IconButton has tile').toBeGreaterThan(0);
    none(
      grep(
        under(shippedTsx, 'features/analyzer/guidance/'),
        /<Button\b[^>]*>\s*<Icon name="trash"[^>]*\/>\s*<\/Button>/,
      ),
    );
    // E-34: the access Remove action is a red ban tile
    const remove = elements(src('features/datasets/detail/AccessTab.tsx'), ['IconButton']).filter((e) =>
      /label=\{?[`'"]Remove/.test(e.attrs),
    );
    expect(remove.length).toBeGreaterThan(0);
    for (const e of remove) {
      expect(e.attrs).toContain('icon="ban"');
      expect(e.attrs).toMatch(/\btile\b/);
      expect(e.attrs).toContain('tone="danger"');
    }
  });

  it('A-04: the row actions column folds behind a label', () => {
    const dt = src('ui/DataTable/DataTable.tsx');
    expect(dt).toMatch(/foldLabel: \(\) => 'Row actions'/);
    expect(dt).toMatch(/data-pseudo="actions"[^>]*data-fold/);
  });

  it('A-05: an openable row has no external-link row action', () => {
    const problems = shippedTsx
      .filter((f) => /\b(onRowOpen|rowHref)=/.test(read(f)) && /\browActions=/.test(read(f)))
      .filter((f) => /icon:\s*'external'/.test(read(f)))
      .map(rel);
    none(problems);
  });

  it('A-06: a danger IconButton is red at rest; RunCards remove uses it', () => {
    const icon = allRules(src('ui/IconButton/IconButton.module.css')).filter(
      ([s, b]) =>
        /\[data-tone=['"]danger['"]\]/.test(s) &&
        !/data-hovered/.test(s) &&
        /color:\s*var\(--error\)/.test(b),
    );
    expect(icon.length).toBeGreaterThan(0);
    const css = src('features/compare/components/RunCards.module.css');
    expect(css).not.toMatch(/\.remove:hover|\.remove:focus-visible/);
    expect(rule(css, '.remove').replace(/\s+/g, ' ').trim()).toBe('flex: none;');
    expect(src('features/compare/components/RunCards.tsx')).not.toMatch(
      /<button\b[^>]*className=\{styles\.remove\}/,
    );
  });

  it('A-07: both quick filter panels hide with a close IconButton', () => {
    for (const p of [
      'features/run-detail/components/QuickFilters.tsx',
      'features/compare/components/QuickFilters.tsx',
    ])
      expect(src(p), p).toContain('label="Hide quick filters" icon="close"');
  });

  it('A-08: a download button is accent with the download icon', () => {
    const problems: string[] = [];
    const exportText = new Set(['CSV', 'Export', 'Export CSV', 'Export HTML', 'Download diff']);
    for (const f of shippedTsx) {
      const text = read(f);
      const footers: [number, number][] = [];
      for (const m of text.matchAll(/footer=\{/g)) {
        const v = propValue(text, 'footer', m.index);
        if (v) footers.push([m.index!, m.index! + v.length]);
      }
      for (const b of buttons(text)) {
        const at = text
          .split('\n')
          .slice(0, b.line - 1)
          .join('\n').length;
        const inFooter = footers.some(([s, e]) => at >= s && at <= e);
        if (/name="download"/.test(b.attrs) && !inFooter && !/variant="accent"/.test(b.attrs))
          problems.push(`${rel(f)}:${b.line}: download button is not accent`);
        if (/name="expand"/.test(b.attrs) && /CSV/.test(b.text))
          problems.push(`${rel(f)}:${b.line}: CSV with expand`);
        // E-31
        if (exportText.has(b.text) && !(/variant="accent"/.test(b.attrs) && /name="download"/.test(b.attrs)))
          problems.push(`${rel(f)}:${b.line}: '${b.text}' is not accent + download`);
      }
    }
    none(problems);
  });

  it('A-09: menus use drawn icons, no typed arrows and no faded disabled items', () => {
    const icon = src('ui/Icon/Icon.tsx');
    for (const n of ['sheet', 'xgrid', 'braces', 'braces-lines', 'picture', 'html-file'])
      expect(icon, n).toContain(`'${n}'`);
    expect(src('ui/DropdownMenu/DropdownMenu.tsx')).not.toMatch(/item\.href \? <Icon name="external"/);
    none(grep(shippedTsx, /label: '[↓↑→]/));
    none(grep(shippedTsx, /label[:=]\s*["'`{]*↓ /));
    expect(src('UserMenu.tsx')).toContain('ActionTile');
    expect(src('features/datasets/detail/ItemsTab.tsx')).toContain('ActionTile');
    expect(rule(src('ui/DropdownMenu/DropdownMenu.module.css'), '.item[data-disabled]')).not.toContain(
      'opacity',
    );
  });

  it('A-10: the dataset catalog header holds no search and New dataset has no end icon', () => {
    const page = src('features/datasets/catalog/CatalogPage.tsx');
    const at = page.indexOf('<PageHeader');
    const actions = propValue(page, 'actions', at) ?? '';
    expect(actions).not.toContain('SearchField');
    const nd = buttons(page).filter((b) => b.text === 'New dataset');
    expect(nd.length).toBeGreaterThan(0);
    for (const b of nd) expect(b.attrs).not.toContain('iconEnd');
  });

  it('A-11: a disabled button explains itself through disabledReason, not a span title', () => {
    none(grep(shippedTsx, /<span[^>]*title="[^"]*"[^>]*>\s*\{button\}/));
  });

  it('A-12: the experiment page has no local header action row', () => {
    expect(src('ExperimentDetailPage.tsx')).not.toContain('styles.headerActions');
    expect(rule(src('features/experiments/detail/detail.module.css'), '.page > [data-page-header]')).toMatch(
      /margin-bottom:\s*0/,
    );
  });

  it('A-13: worker actions live in WorkerActions only', () => {
    expect(src('features/live/components/worker/JobsBlock.tsx')).not.toContain('Backfill a day range');
    const strip = src('features/live/components/worker/StatusStrip.tsx');
    expect(strip).not.toContain('Backfill a day range');
    expect(strip).not.toContain('<Button');
    const actions = src('WorkerActions.tsx');
    expect(actions).toContain('Backfill a day range');
    expect(actions).toContain('Pause evaluation');
    expect(src('features/live/components/worker/SettingsForm.tsx')).toContain('label="Worker key"');
  });

  it('A-14: the live manage action names the worker', () => {
    expect(src('features/live/components/StatusLine.tsx')).not.toContain('>Manage<');
    expect(src('LiveOverviewPage.tsx')).toMatch(/>\s*Manage worker\s*<\/LinkButton>/);
  });

  it('A-15: a back link uses the prev icon, never a typed arrow', () => {
    const problems: string[] = [];
    const skip = ['features/shell/login/LoginPage.tsx', 'export/ExportApp.tsx'];
    for (const f of shippedTsx) {
      const text = read(f);
      if (/\{'←'\}/.test(text)) problems.push(`${rel(f)}: {'←'}`);
      for (const e of elements(text, ['Link', 'LinkButton', 'Button'])) {
        if (/^← /.test(e.text)) problems.push(`${rel(f)}:${e.line}: '${e.text}'`);
        // E-03
        if (skip.some((s) => rel(f).endsWith(s))) continue;
        if (
          /^(Back to|All environments|All experiments)/.test(e.text) &&
          !/icon=\{<Icon name="prev"/.test(e.attrs)
        )
          problems.push(`${rel(f)}:${e.line}: '${e.text}' has no prev icon`);
      }
    }
    none(problems);
  });

  it('A-16: turn filters are a bar with a clear button, no popover', () => {
    const t = src('TurnFilters.tsx');
    for (const s of ['icon="close"', 'Popover', 'QuickFilterGroup', 'FilterControl', '>Done<'])
      expect(t, s).not.toContain(s);
    for (const s of ['ClearFiltersButton', 'BarTrigger', 'shortcut="/"']) expect(t, s).toContain(s);
  });

  it('A-17: a name link is not underlined and not blue', () => {
    expect(read(join(SRC, 'styles/base.css'))).toContain("a[data-link='name']");
    const blue: string[] = [];
    for (const f of shippedCss.filter((x) => x.endsWith('.module.css')))
      for (const [s, b] of allRules(read(f)))
        if (
          /color:\s*var\(--accent-secondary\)/.test(b) &&
          s.split(',').some((x) => /\.[\w-]*Link(:[\w-]+|\[[^\]]*\])*$/.test(x.trim()))
        )
          blue.push(`${rel(f)}: ${s.replace(/\s+/g, ' ')}`);
    none(blue);
    // E-51: no hover underline in a CSS module (login and docs excepted)
    const under: string[] = [];
    for (const f of outside(shippedCss, 'features/docs/', 'sdk-viewer/').filter((x) =>
      x.endsWith('.module.css'),
    )) {
      if (rel(f) === 'features/shell/login/LoginPage.module.css') continue;
      for (const [s, b] of allRules(read(f)))
        if (/:hover/.test(s) && /text-decoration\s*:\s*underline/.test(b))
          under.push(`${rel(f)}: ${s.replace(/\s+/g, ' ')}`);
    }
    none(under);
  });

  it('A-18: a link moves on with a chevron icon, never a typed arrow', () => {
    none(grep(shippedTsx, /View all →|↗<\//));
    const problems: string[] = [];
    for (const f of shippedTsx)
      for (const b of buttons(read(f)))
        if (/iconEnd=\{<Icon name="chevron-right"/.test(b.attrs)) problems.push(`${rel(f)}:${b.line}`);
    none(problems);
    const empty = src('ui/EmptyState/EmptyState.tsx');
    expect(empty).toContain('chevron-right');
    // E-28 / D-13: no JSX text ends with a typed →
    none(grep(shippedTsx, /→\s*(<\/|$)/m));
    expect(src('features/runs-list/OverviewPage.tsx')).not.toContain('→');
    // C-37
    expect(src('features/live/LiveEmptyState.tsx')).not.toContain('LinkButton');
  });

  it('A-19: an external link ends with the external icon', () => {
    const tsx = outside(shippedTsx, 'features/dev/');
    none(grep(tsx, /icon=\{<Icon name="external"/));
    const problems: string[] = [];
    for (const f of tsx) {
      const lines = read(f).split('\n');
      lines.forEach((l, i) => {
        if (!l.includes('target="_blank"')) return;
        const near = lines.slice(Math.max(0, i - 6), i + 9).join('\n');
        if (!near.includes('name="external"')) problems.push(`${rel(f)}:${i + 1}`);
      });
    }
    none(problems);
  });

  it('A-20: the run hero shows hidden tags with MoreTag', () => {
    const hero = src('features/run-detail/components/RunHero.tsx');
    expect(hero).toMatch(/<MoreTag\s+count=\{hidden\}/);
    expect(hero).not.toContain('`+ ${hidden} more`');
    expect(hero).not.toContain('variant="ghost"');
    expect(src('ui/Tag/MoreTag.tsx')).toContain('+{count} more');
    expect(src('ui/Tag/index.ts')).toMatch(/\bMoreTag\b/);
    expect(src('features/run-detail/components/RunHero.module.css')).toContain('.groupGrid');
  });

  it('A-21: an overflow menu trigger is not a bare "more" IconButton', () => {
    for (const p of ['DatasetDetailPage.tsx', 'ActionRail.tsx', 'LaunchBar.tsx'])
      expect(src(p), p).not.toMatch(/trigger=\{\s*<IconButton[^>]*icon="more"/);
  });

  it('A-22: IconButton and LinkButton give a disabled reason on hover', () => {
    for (const p of ['ui/IconButton/IconButton.tsx', 'ui/LinkButton/LinkButton.tsx']) {
      expect(src(p), p).toContain('disabledReason');
      expect(src(p), p).toContain('reasonWrap');
    }
  });

  it('A-23: the worker settings save once, in a SaveFooter', () => {
    const form = src('features/live/components/worker/SettingsForm.tsx');
    expect(form.split('No changes since v').length - 1).toBe(1);
    expect(form).not.toMatch(/<Text tone="muted">\s*After Save/);
    expect(src('features/live/worker.module.css')).not.toMatch(/\.saveRow\b/);
    expect(form).toContain('<SaveFooter');
    expect(form).not.toContain('help="Optional"');
    expect(form).not.toContain('styles.saveRow');
  });

  it('A-24: a CopyButton gives its own feedback (no onCopied)', () => {
    none(grep(outside(shippedTsx, 'ui/CopyButton/'), /<CopyButton\b[^>]*onCopied=/));
  });

  it('A-25: empty-state actions sit a small gap apart', () => {
    expect(rule(src('ui/EmptyState/EmptyState.module.css'), '.action')).toMatch(/gap:\s*var\(--space-sm\)/);
  });

  it('A-26: the analyze action casts no shadow', () => {
    expect(src('features/runs-list/AnalyzeAction.module.css')).not.toContain('box-shadow');
  });

  it('A-28: launch settings use Buttons, not link-styled buttons', () => {
    const problems: string[] = [];
    for (const f of under(shippedTsx, 'features/experiments/launch/'))
      for (const e of elements(read(f), ['button']))
        if (/className=\{styles\.linkBtn\}/.test(e.attrs) && /^(Sweep values|Reset|Remove)$/.test(e.text))
          problems.push(`${rel(f)}:${e.line}: ${e.text}`);
    none(problems);
  });
});

describe('consistency v3: family B (status, tags, counts, tones)', () => {
  const noDev = outside(shippedTsx, 'features/dev/');

  it('B-01: a published version is an info mark; production is not an info flag', () => {
    for (const p of [
      'features/analyzer/guidance/RulesPanel.tsx',
      'features/datasets/components/VersionSwitcher.tsx',
    ]) {
      const t = src(p);
      expect(t, p).not.toContain('label="Live"');
      for (const e of elements(t, ['StatusMark']).filter((x) => /label="Published"/.test(x.attrs)))
        expect(e.attrs, `${p}:${e.line}`).toContain('tone="info"');
    }
    expect(src('features/datasets/components/VersionSwitcher.tsx')).not.toMatch(
      /<Flag tone="info"[^>]*>\s*Production/,
    );
  });

  it('B-02: a succeeded job is a full success mark', () => {
    expect(src('features/admin/maintenance/JobsTable.tsx')).toMatch(/succeeded:\s*\['success',\s*'full'\]/);
  });

  it('B-03: StatusMark takes tone, never data-tone; a running orbit is not green', () => {
    none(grep(noDev, /<StatusMark[^>]*data-tone=/s));
    const problems: string[] = [];
    for (const f of under(shippedTsx, 'features/live/'))
      for (const e of elements(read(f), ['StatusMark']))
        if (/shape=["{']*orbit/.test(e.attrs) && /tone=["{']*success/.test(e.attrs))
          problems.push(`${rel(f)}:${e.line}`);
    none(problems);
  });

  // Status rules (2026-11-12): health is a StateTag now; this guard keeps the old dot and ad-hoc tags out.
  it('B-04: environment health is the shared HealthTag, not a dot or an ad-hoc tag', () => {
    expect(src('features/environments/EnvironmentsTable.module.css')).not.toMatch(/\.dot\b[^{]*\{/);
    const picker = src('features/experiments/launch/entry/EnvironmentPicker.tsx');
    for (const s of ['>Healthy</Tag>', '>Unhealthy', '>Not checked</Tag>'])
      expect(picker, s).not.toContain(s);
    const queue = src('features/experiments/queue/QueuePage.tsx');
    expect(queue).not.toContain('shape="cross" label={env.health_status}');
    expect(queue).not.toContain('<Flag tone="warning" icon="warning">');
  });

  it('B-05: a worker job status is a mark, not a tag', () => {
    for (const p of [
      'features/live/components/worker/JobsBlock.tsx',
      'features/live/components/worker/SettingsForm.tsx',
    ])
      expect(src(p), p).not.toMatch(/<Tag[^>]*>\s*\{?\s*(row\.status|status)/);
  });

  it('B-06: live verdicts come from verdictOf', () => {
    for (const p of ['features/live/components/turn/Evidence.tsx', 'features/live/components/TurnsTable.tsx'])
      expect(src(p), p).toMatch(/import \{[^}]*\bverdictOf\b[^}]*\} from/);
  });

  it('B-07: verdict tones live in one place; a dark swatch is dim', () => {
    const mix = src('features/live/lib/mix.ts');
    expect(mix).toContain('export function verdictOf');
    expect(mix).not.toContain('function labelTone');
    const css = src('features/live/live.module.css');
    expect(css).toContain('[data-dark] > .swatch');
    expect(css).toContain('--tone: var(--text-dim)');
    expect(src('features/live/lib/trend.ts')).toContain('dark: boolean');
  });

  it('B-08: a live status shows a word, never the raw key', () => {
    const pres = src('features/live/components/turn/presentation.ts');
    expect(pres).toContain("ok: 'OK'");
    expect(pres).toContain('export function statusWord');
    const imp = /import \{[^}]*\bstatusWord\b[^}]*\} from '[^']*presentation'/;
    const canaries = src('features/live/components/Canaries.tsx');
    const evidence = src('features/live/components/turn/Evidence.tsx');
    expect(canaries).toMatch(imp);
    expect(evidence).toMatch(imp);
    expect(canaries).not.toContain('${probe.status}');
    expect(canaries).not.toContain('?? probe.canary}');
    expect(evidence).not.toContain('label={status ??');
    // C-32: no bare key as element text
    for (const t of [canaries, src('features/live/components/worker/ProblemsBlock.tsx')])
      expect(t).not.toMatch(/>\s*\{(probe\.canary|event\.component)\}\s*</);
  });

  it('B-09: a feedback status figure is never info-blue', () => {
    expect(src('features/feedback/badges.tsx')).not.toMatch(/STATUS_FIGURE[^}]*'info'/s);
  });

  it('B-10: a verdict is a drawn mark from VERDICT_MARK, not a typed glyph or a tag', () => {
    none(grep(noDev, /✓ Pass|✗ Fail|⚠ Error/));
    expect(src('features/run-detail/components/items/OutputRegion.tsx')).not.toContain('<Tag tone={tone}');
    expect(src('features/run-detail/components/items/ItemBar.tsx')).not.toContain('<Tag');
    expect(src('features/run-detail/lib/verdictMark.ts')).toMatch(/export const VERDICT_MARK\b/);
    expect(src('features/run-detail/components/items/ItemsTable.tsx')).not.toContain('const STATUS_MARK');
  });

  it('B-11: the worker state is a StateTag from workerStateTag', () => {
    const hist = src('features/live/components/worker/HistoryBlock.tsx');
    expect(hist).not.toContain("' · running'");
    expect(hist).not.toContain("'success' : 'primary'");
    const line = src('features/live/components/StatusLine.tsx');
    expect(line).not.toContain('Worker · {control.state}');
    expect(line).toMatch(/workerStateTag\(control\.state/);
    expect(src('features/live/components/worker/format.ts')).toMatch(/export function workerStateTag\b/);
  });

  it('B-12: required is a RequiredFlag, not a tag', () => {
    none(grep(noDev, /<Tag kind="role">\s*required|<Tag>Required<\/Tag>/));
    expect(src('ui/Flag/Flag.tsx')).toMatch(/export function RequiredFlag\b/);
  });

  it('B-13: official is an info shield flag', () => {
    none(grep(noDev, /<Tag kind="accent"[^>]*>\s*Official/));
    for (const p of [
      'features/runs-list/cells.tsx',
      'features/runs-list/OverviewPage.tsx',
      'features/run-detail/components/RunPanels.tsx',
      'features/experiments/RunExperimentPanel.tsx',
    ])
      expect(src(p), p).toContain('<Flag tone="info" icon="shield"');
  });

  it('B-14: every ModelTag carries its series', () => {
    const problems: string[] = [];
    for (const f of outside(noDev, 'ui/'))
      for (const e of elements(read(f), ['ModelTag']))
        if (!/\bseries=/.test(e.attrs)) problems.push(`${rel(f)}:${e.line}`);
    none(problems);
    expect(src('features/runs-list/model.ts')).toContain('export function modelSeriesOf');
    expect(src('features/run-detail/components/RunHero.tsx')).not.toContain('function modelSeriesOf');
  });

  it('B-15: entity names are entity tags, not joined text', () => {
    const row = src('features/reviews/ReviewRow.tsx');
    // the issue summary (category · subcategory · finding) is text; entity names are tags
    expect(row).not.toMatch(/row\.(task|dataset|model)\b[^\n]*\]\s*\.filter\(Boolean\)\s*\.join\(' · '\)/);
    for (const t of ['<TaskTag', '<DatasetTag', '<ModelTag']) expect(row, t).toContain(t);
    expect(src('features/live/components/turn/DiagnosisTab.tsx')).not.toContain("judgeModels.join(' · ')");
    const line = src('features/live/components/StatusLine.tsx');
    expect(line).not.toMatch(/<Tag[^>]*kind="data"[^>]*>\s*\{judge\}/);
    expect(line).toContain('<ModelTag');
    expect(src('features/live/components/worker/SettingsForm.tsx')).toContain('<ModelTag');
    const names = src('features/datasets/catalog/UnregisteredNames.tsx');
    expect(names).toMatch(/import \{[^}]*\bDatasetTag\b/);
    expect(names).not.toContain('styles.unregisteredName');
  });

  it('B-17: admin is a gold role tag', () => {
    const tokens = read(join(SRC, 'styles/tokens.css'));
    expect(tokens).toContain('--role-admin: #e0bc4a');
    expect(tokens).toContain('--tint-gold: 17%');
    expect(read(join(SRC, 'styles/tones.css'))).toMatch(/\[data-tone=['"]gold['"]\]/);
    expect(src('ui/Tag/Tag.tsx')).toMatch(/role === 'admin' \? 'gold'/);
  });

  it('B-18: compare names no run side with a role tag', () => {
    none(grep(under(shippedTsx, 'features/compare/'), /<Tag kind="role">/));
    expect(src('features/compare/components/RunCards.module.css')).not.toMatch(/^\.side \{/m);
    const cards = src('features/compare/components/RunCards.tsx');
    expect(cards).not.toContain('sideLabel');
    expect(cards).not.toContain('sideOf');
  });

  it('B-19: a role tag holds a role word only', () => {
    // D-28: a dataset access level (View, Modify) is a role word too: it takes the Members role Tag look
    const role =
      /^\s*(admin|manager|member|view|modify|\{[^{}]*\b(me|m|project|u|p)\.role\b[^{}]*\}|\{[^{}]*\br\.level\b[^{}]*\})\s*$/i;
    const problems: string[] = [];
    for (const f of noDev)
      for (const e of elements(read(f), ['Tag']))
        if (/kind="role"/.test(e.attrs) && !role.test(e.inner))
          problems.push(`${rel(f)}:${e.line}: ${e.inner.trim()}`);
    none(problems);
    none(grep(noDev, /<Tag kind="accent">\{issue\.category/));
  });

  it('B-20: every list search is the one SearchField at --search-width with the / hint', () => {
    const css = src('ui/SearchField/SearchField.module.css');
    expect(css).not.toMatch(/font-size:\s*var\(--font-xs\)/);
    expect(rule(css, '.hint')).not.toContain('--font-xs');
    expect(src('ui/SearchField/SearchField.tsx')).toContain('<Kbd');
    // D-14
    const feat = under(noDev, 'features/');
    none(grep(feat, /type="search"|placeholder=["'{`]*Filter by/));
    expect(read(join(SRC, 'styles/tokens.css'))).toContain('--search-width: 260px');
    const widths: string[] = [];
    for (const f of feat)
      for (const e of elements(read(f), ['SearchField']))
        if (/width=\{(240|280|320)\}/.test(e.attrs)) widths.push(`${rel(f)}:${e.line}`);
    none(widths);
    // E-36
    expect(src('features/runs-list/FilterBar.tsx')).toContain("phone ? 220 : 'var(--search-width)'");
    // E-50: each list page search shows the / hint
    const pages = [
      'features/runs-list/FilterBar.tsx',
      'features/experiments/list/ExperimentsPage.tsx',
      'features/experiments/queue/QueuePage.tsx',
      'features/datasets/catalog/CatalogPage.tsx',
      'features/datasets/detail/ItemsTab.tsx',
      'features/trash/TrashPage.tsx',
      'features/shell/projects/ProjectsPage.tsx',
      'features/admin/users/UsersTable.tsx',
      'features/admin/projects/ProjectsTable.tsx',
      'features/admin/runs/RunsTab.tsx',
      'features/feedback/FeedbackListPage.tsx',
      'features/reviews/ReviewsPage.tsx',
      'features/live/components/TurnFilters.tsx',
      'features/run-detail/components/traces/TraceDrawer.tsx',
      'features/compare/components/rd/TraceDrawer.tsx',
    ];
    const missing = pages.filter(
      (p) => !elements(src(p), ['SearchField']).some((e) => /(shortcut|hint)="\/"/.test(e.attrs)),
    );
    none(missing);
  });

  it('B-21: review chips are plain sans text', () => {
    const css = src('features/reviews/DetailPane.module.css');
    const chips = allRules(css).filter(([s]) => /\.chip/.test(s));
    for (const [s, b] of chips) {
      expect(b, s).not.toMatch(/text-transform:\s*uppercase/);
      expect(b, s).not.toContain('var(--accent-secondary)');
      expect(b, s).not.toMatch(/text-overflow:\s*ellipsis/);
    }
  });

  it('B-22: no page draws its own step number', () => {
    none(grep(outside(shippedCss, 'features/feedback/'), /\.stepNum\b/));
  });

  it('B-23: the sweep move marker is plain', () => {
    const move = rule(src('features/compare/components/sweep/SweepView.module.css'), '.move');
    expect(move).not.toContain('border-radius');
    expect(move).not.toMatch(/background/);
  });

  it('B-24: the user menu avatar uses the user series', () => {
    const menu = src('features/shell/chrome/UserMenu.tsx');
    expect(menu).toContain('userSeries');
    expect(menu).not.toMatch(/function initials\b/);
    expect(rule(src('features/shell/chrome/UserMenu.module.css'), '.avatar')).not.toContain(
      'var(--font-mono)',
    );
  });

  it('B-25: a person is a UserName with an id', () => {
    const cells = src('ui/DataTable/cells/cells.tsx');
    const body = fnBody(cells, 'UserCell');
    expect(body).toContain('<');
    expect(body).not.toContain('Identicon');
    const problems: string[] = [];
    for (const f of under(noDev, 'features/'))
      for (const e of elements(read(f), ['UserName']))
        if (!/\bid=/.test(e.attrs)) problems.push(`${rel(f)}:${e.line}`);
    none(problems);
    // E-39
    const req = src('features/feedback/RequestPage.tsx');
    expect(req).toContain('<UserName');
    expect(req).not.toContain('<strong>{e.actor');
  });

  it('B-26: a person label has no "By:" colon', () => {
    none(grep(noDev, /<UserPill[^>]*label="[^"]*:"/));
    none(grep(noDev, /^\s*label="[A-Z][a-z]+ By:"/m));
    none(grep(noDev, /[\s"]By:/));
  });

  it('B-27: a section count is the SectionHeader count tag', () => {
    expect(src('features/datasets/detail/AccessTab.tsx')).not.toMatch(/aside=\{[^}]*access-count/s);
    expect(src('features/live/components/worker/ProblemsBlock.tsx')).not.toMatch(
      /<Text tone="danger">[^<]*in the last hour/,
    );
    expect(src('ui/SectionHeader/SectionHeader.tsx')).toMatch(/\bcount\?:/);
  });

  it('B-28: a count is a CountTile, never "(N)"', () => {
    const tsx = outside(noDev, 'sdk-viewer/');
    none(grep(tsx, /\(\$?\{[^}]*(\.length|\.size|[cC]ount)\}\)/));
    none(grep(tsx, /[A-Za-z0-9] <CountTile|\{' '\}\s*<CountTile/));
    expect(rule(src('ui/CountTile/CountTile.module.css'), '.tile')).toMatch(
      /margin-inline-start:\s*var\(--space-xs\)/,
    );
    expect(rule(src('ui/Tabs/Tabs.module.css'), '.count')).toMatch(/justify-content:\s*center/);
  });

  it('B-29: an overflow count is a MoreTag', () => {
    const tsx = outside(noDev, 'sdk-viewer/');
    none(grep(tsx, /… and (\d|\{)/));
    none(grep(tsx, /\+ \{[^}]*\}\s*more/));
    none(grep(tsx, /<li[^>]*>\+\{/));
    expect(src('ui/DataTable/cells/cells.tsx')).toMatch(/import \{[^}]*\bMoreTag\b/);
  });

  it('B-30: the run hero writes no "x{samples}"', () => {
    expect(src('features/run-detail/components/RunHero.tsx')).not.toContain('x{samples}');
  });

  it('B-31: a lineage change count is a count tag', () => {
    const problems: string[] = [];
    for (const e of elements(src('features/datasets/detail/LineageTab.tsx'), ['Tag']))
      if (/^\s*[+−~]\{/.test(e.inner) && !/kind="count"/.test(e.attrs))
        problems.push(`${e.line}: ${e.inner}`);
    none(problems);
  });

  it('B-32: dataset items filter in a bar with a clear button, not a segmented control', () => {
    const items = src('features/datasets/detail/ItemsTab.tsx');
    expect(items).not.toMatch(/import \{[^}]*\b(SegmentedControl|Chip)\b[^}]*\} from/);
    expect(items).toContain('<ClearFiltersButton');
    expect(items).toContain('className={styles.filterRow}');
    expect(src('features/datasets/lib/itemState.ts')).not.toContain("label: 'All'");
    const route = src('features/datasets/lib/route.ts');
    const at = route.indexOf('parseItemStateParam');
    expect(at).toBeGreaterThan(-1);
    expect(route.slice(at, route.indexOf('\n}', at))).toContain(": 'all';");
  });

  it('B-33: list pages draw no bold name spans', () => {
    for (const p of [
      'features/shell/projects/ProjectsPage.tsx',
      'features/datasets/catalog/CatalogPage.tsx',
      'features/reviews/ReviewsPage.tsx',
    ])
      expect(src(p), p).not.toContain('<strong>{');
  });

  it('B-34: an AI confidence is not shown as a percent tag', () => {
    const rev = under(shippedTsx, 'features/reviews/');
    none(grep(rev, /<Tag kind="count">\{Math\.round\(|AI confidence/));
    expect(
      rule(src('features/run-detail/components/analysis/MetricAnalysisCards.module.css'), '.conf'),
    ).not.toContain('font-mono');
    const tr = src('features/analyzer/blocks/TestResults.tsx');
    expect(tr).not.toContain('`${Math.round(i.confidence * 100)}%`');
    for (const e of elements(tr, ['Flag'])) expect(e.attrs + e.inner).not.toContain('confidence');
  });

  it('B-35: a job progress is a ProgressCell bar', () => {
    const jobs = src('features/live/components/worker/JobsBlock.tsx');
    expect(jobs).not.toContain(' evaluated, ');
    expect(jobs).toContain('<ProgressCell');
    expect(src('ui/DataTable/cells/cells.module.css')).toContain(".part[data-part='failed']");
  });

  it('B-36: info is the secondary accent', () => {
    const tokens = read(join(SRC, 'styles/tokens.css'));
    expect(tokens).toContain('--info: var(--accent-secondary);');
    expect(tokens).not.toContain('#3b82f6');
  });

  it('B-37: a stat or version pill is not accent-toned', () => {
    for (const p of ['features/admin/AdminPage.tsx', 'features/runs-list/OverviewPage.tsx']) {
      expect(src(p), p).not.toContain("tone: 'accent'");
      expect(src(p), p).not.toContain("? 'accent'");
    }
    expect(
      rule(src('features/datasets/components/VersionSwitcher.module.css'), '.pillVersion'),
    ).not.toContain('--accent-primary');
  });

  it('B-38: latency kinds use the chart series (tool is warning)', () => {
    const css = src('features/run-detail/components/panels/Latency.module.css');
    const decls = [...css.matchAll(/(--k-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]);
    expect(decls.length).toBeGreaterThan(0);
    for (const [k, v] of decls)
      if (k === '--k-tool') expect(v).toBe('var(--warning)');
      else expect(v, k).toMatch(/^var\(--chart-\d\)$/);
    expect(css).toContain('--k-agent: var(--chart-6)');
    expect(css).toContain('--k-eval: var(--chart-2)');
  });

  it('B-39: feedback priority: medium warns, high is danger', () => {
    const b = src('features/feedback/badges.tsx');
    const map = b.slice(b.indexOf('PRIORITY_TONE'), b.indexOf('};', b.indexOf('PRIORITY_TONE')));
    expect(map).toMatch(/medium:\s*'warning'/);
    expect(map).toMatch(/high:\s*'danger'/);
  });

  it('B-40: a worker problem level is a StateTag (status rules, 2026-11-12)', () => {
    const p = src('features/live/components/worker/ProblemsBlock.tsx');
    expect(p).not.toContain('<Tag tone={event.level');
    expect(p).toContain('<StateTag');
  });

  it('B-41: a diagnosis axis is not a danger tag', () => {
    expect(src('features/live/components/turn/DiagnosisTab.tsx')).not.toContain(
      "item.axis === 'sql' ? 'danger'",
    );
    expect(src('features/live/turn.module.css')).toContain('.sevError');
  });
});

describe('consistency v3: family C (dates, numbers, words, notices)', () => {
  const noDev = outside(shippedTs, 'features/dev/');
  const live = under(shippedTs, 'features/live/');
  const feat = under(noDev, 'features/');
  /** Text with // and block comments blanked (line numbers kept). */
  const code = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
  const grepCode = (files: string[], re: RegExp, allow: (hit: string) => boolean = () => false) => {
    const out: string[] = [];
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const f of files) {
      const text = code(read(f));
      for (const m of text.matchAll(g)) {
        const line = text.slice(0, m.index).split('\n').length;
        const hit = `${rel(f)}:${line}: ${read(f).split('\n')[line - 1]!.trim().slice(0, 100)}`;
        if (!allow(hit)) out.push(hit);
      }
    }
    return out;
  };

  it('C-02: live times are local times (no UTC word, no hand-cut ISO clock)', () => {
    none(grepCode(live, /(['"`])[^'"`\n]*\bUTC\b[^'"`\n]*\1/));
    none(grepCode(live, /'en-GB'/));
    none(grepCode(live, /\.toISOString\(\)\.slice\(11/));
    // shiftDay and the explicit fallbacks of three pages may cut a day key (this list may only shrink)
    const dayCut = [
      'features/live/lib/day.ts',
      'features/live/LiveRoutes.tsx',
      'features/live/LiveOverviewPage.tsx',
      'features/live/components/worker/DateRangeDialog.tsx',
    ];
    none(
      grepCode(live, /\.toISOString\(\)\.slice\(0, 10\)/, (h) => dayCut.some((p) => h.startsWith(`${p}:`))),
    );
    const day = src('features/live/components/DaySwitcher.tsx');
    expect(day).not.toMatch(/import \{[^}]*\bPopover\b/);
    expect(day).not.toContain('UTC');
    // shim: presentation.ts keeps a utcTime alias until the cv3-shim removal
    none(grepCode(live, /\butcTime\b/), 'no utcTime in features/live');
  });

  it('C-03: a stale live page shows one notice, not a tinted status card', () => {
    const line = src('features/live/components/StatusLine.tsx');
    // the red Stale StatusMark stays; the card itself takes no stale tone or wash
    none(
      elements(line, ['[A-Z][A-Za-z.]*'])
        .filter((e) => e.name !== 'StatusMark' && /tone=\{stale/.test(e.attrs))
        .map((e) => `${e.line}: <${e.name} tone={stale`),
    );
    expect(line).not.toContain('wash=');
    expect(src('features/live/live.module.css')).not.toMatch(/\.status\[data-stale\]/);
    for (const m of line.matchAll(/staleText/g)) {
      const before = line.slice(Math.max(0, m.index! - 200), m.index);
      if (/^\s*(const|let)\b/.test(line.slice(line.lastIndexOf('\n', m.index) + 1, m.index))) continue;
      if (/import/.test(line.slice(line.lastIndexOf('\n', m.index) + 1, m.index))) continue;
      expect(before, 'staleText renders only under stale ? null :').toMatch(/stale \? null :/);
    }
    expect(src('features/live/LiveOverviewPage.tsx')).toContain('live-stale-notice');
  });

  it('C-04: relative times come from lib/dates', () => {
    none(grep(feat, /`\$\{[^}]+\}(m|h|d) ago`/));
  });

  it('C-05: trash days and access times are sans', () => {
    expect(rule(src('features/trash/TrashPage.module.css'), '.day')).not.toContain('--font-mono');
    expect(rule(src('features/datasets/detail/AccessTab.module.css'), '.when')).not.toContain('--font-mono');
  });

  it('C-06: history times are sans', () => {
    expect(rule(src('features/datasets/detail/LineageTab.module.css'), '.logTime')).not.toContain(
      '--font-mono',
    );
    expect(rule(src('features/datasets/item/ItemHistoryTab.module.css'), '.when')).not.toContain(
      '--font-mono',
    );
    expect(rule(src('features/reviews/DetailPane.module.css'), '.histWhen')).not.toContain('--font-mono');
  });

  it('C-07: a feedback request header reads name · date', () => {
    expect(src('features/feedback/RequestPage.tsx')).toMatch(
      /r\.submitter\.name[^\n]*\n?[^\n]*headerDate\(r\./,
    );
    expect(src('features/feedback/RequestsTable.tsx')).not.toContain('shortDate');
  });

  it('C-08: no feature reads a local hour by hand', () => {
    none(grep(feat, /getHours\(\)/, ['features/run-detail/lib/itemText.ts']));
  });

  it('C-09: no hand-made "N s ago"', () => {
    const files = noDev.filter((f) => rel(f) !== 'lib/dates.ts');
    none(grep(files, /\b(s|min|h|d) ago`/));
    none(grep(files, /\}s ago/));
  });

  it('C-10: "Last updated" reads formatAgo, not a clock with seconds', () => {
    // shim: lib/format.ts keeps a deprecated formatClock until the cv3-shim removal
    none(grep(noDev, /formatClock/));
  });

  it('C-12: every score shows one decimal (no neighbour-based digits)', () => {
    // shim: runs-list/model.ts keeps a deprecated smartDigits until the cv3-shim removal
    none(grep(feat, /smartDigits|metric_neighbor_values/));
  });

  it('C-13: a score shows one decimal and a dataset score is a number', () => {
    expect(src('ui/ScoreValue/ScoreValue.tsx')).toContain('digits = 1');
    none(grep(under(shippedTsx, 'features/datasets/'), /<ScoreBar\b/));
    expect(src('features/datasets/detail/ItemsTab.tsx')).not.toMatch(/import \{[^}]*\bScoreBar\b/);
    // axis ticks, shares and settings keep whole percents (spec C-13 exceptions; may only shrink)
    const allow = [
      'features/run-detail/lib/boxFormat.ts',
      'features/run-detail/components/latency/QualityLatency.tsx',
      'features/runs-list/RunScatterCard.tsx',
      'features/runs-list/TrendChart.tsx',
      'features/run-detail/components/charts/Charts.tsx',
      'features/run-detail/components/panels/DeepTab.tsx',
      'features/run-detail/components/panels/RepeatTab.tsx',
      'features/run-detail/lib/activeChips.ts',
      'features/run-detail/components/latency/LatencyDistribution.tsx',
      'features/run-detail/components/latency/TimeBudget.tsx',
      'features/run-detail/lib/rowDisplay.ts',
      'features/compare/lib/rowCells.ts',
      'features/run-detail/components/panels/DatasetsSection.tsx',
      'features/runs-list/ChartsTable.tsx',
    ];
    none(grep(noDev, /formatPercent(Value)?\([^(),]+(\([^()]*\))?[^(),]*, 0\)/, allow));
  });

  it('C-14: best-run scores are numbers with a direction', () => {
    const t = src('features/experiments/launch/bestrun/RunsTable.tsx');
    expect(t).not.toContain('<ScoreBar');
    expect(t).toContain('metricDir(r.direction)');
  });

  it('C-15: compare count buttons draw no typed triangles', () => {
    const t = src('features/compare/components/common.tsx');
    const body = fnBody(t, 'CountButtons');
    expect(body).toContain('<');
    expect(body).not.toMatch(/[▲▼]/);
  });

  it('C-16: a delta is signed points with drawn arrows', () => {
    for (const p of [
      'features/compare/components/panel/AveragesMatrix.tsx',
      'features/compare/components/panel/StepsTab.tsx',
    ])
      expect(src(p), p).not.toMatch(/< -0\.02 \? '▼'/);
    const sweep = src('features/compare/components/sweep/SweepView.tsx');
    expect(sweep).not.toContain('signed(delta, 0)');
    expect(fnBody(sweep, 'signed')).toMatch(/ pts`;?\s*$/);
  });

  it('C-18: live percents keep one decimal and scores align left', () => {
    none(grep(live, /formatPercentValue\([^,]+, (0|spec)/));
    expect(src('features/live/components/TurnsTable.tsx')).not.toContain("align: 'end'");
  });

  it('C-19: a live score never reads True/False', () => {
    none(grep(live, /\? 'True' : 'False'/));
  });

  it('C-20: a time unit sits right after its number', () => {
    none(grepCode(noDev, /\}\s(ms|s|min|h)\b[`' ]/));
  });

  it('C-21: percentiles are lower-case and units sit tight', () => {
    expect(
      rule(src('features/run-detail/components/latency/Response.module.css'), '.heroValue small'),
    ).not.toContain('margin-left');
    const traces = src('features/run-detail/components/latency/Traces.module.css');
    expect(rule(traces, '.total small')).not.toContain('margin-left');
    expect(rule(traces, '.kvalue small')).not.toContain('margin-left');
    none(grepCode(noDev, /\bP(50|90|95|99)\b/));
  });

  it('C-22: tokens are written out, never "tok"', () => {
    none(grep(shippedTsx, /\} tok</));
  });

  it('C-23: no lightning glyph in features', () => {
    none(grep(feat, /⚡/));
  });

  it('C-24: no ellipsis in a placeholder or menu label, ternaries included', () => {
    const progress = /ing\b[^…]*…$/;
    // partial values on purpose (C-25 exceptions); this list may only shrink
    const allow = [
      'features/live/components/worker/StatusStrip.tsx',
      'features/live/components/worker/SettingsForm.tsx',
    ];
    const problems: string[] = [];
    for (const f of outside(shippedTsx, ...allow)) {
      const t = read(f);
      for (const m of t.matchAll(/placeholder=\{/g)) {
        const v = propValue(t, 'placeholder', m.index) ?? '';
        for (const s of v.matchAll(/(['"`])([^'"`]*…)\1/g))
          if (!progress.test(s[2]!)) problems.push(`${rel(f)}: placeholder '${s[2]}'`);
      }
      for (const m of t.matchAll(/\blabel:\s*([^,\n]*…[^,\n]*)/g))
        for (const s of m[1]!.matchAll(/(['"`])([^'"`]*…)\1/g))
          if (!progress.test(s[2]!)) problems.push(`${rel(f)}: label '${s[2]}'`);
    }
    none(problems);
  });

  it('C-25: a key-value tag never truncates', () => {
    const css = src('ui/Tag/KeyValueTag.module.css');
    for (const s of ['.key', '.value']) {
      expect(rule(css, s), s).not.toMatch(/text-overflow:\s*ellipsis/);
      expect(rule(css, s), s).not.toMatch(/white-space:\s*nowrap/);
    }
  });

  it('C-26: a run is a run, never an "eval run"', () => {
    const files = outside(noDev, 'features/docs/');
    none(grepCode(files, /(['"`>])[^'"`<\n]*\b(eval|evaluation) runs?\b/i));
  });

  it('C-27: reviews say root cause, not diagnosis', () => {
    const files = under(shippedTsx, 'features/reviews/');
    none(
      grepCode(files, /(['"`>]|^\s*)[^'"`<>{}\n]*\b[Dd]iagnos(is|es)\b[^'"`<>{}\n]*(['"`<]|$)/m, (h) =>
        /\b(type|interface|import)\b|\.diagnos|diagnos\w*[:?]|Diagnos\w+\b/.test(
          h
            .split(': ')
            .slice(1)
            .join(': ')
            .replace(/[Dd]iagnos(is|es)\b/, ''),
        ),
      ),
    );
  });

  it('C-28: one "Create project" only, the dialog confirm', () => {
    none(grep(noDev, /Create project\b/, ['features/shell/dialogs/CreateProjectDialog.tsx']));
    expect(src('features/shell/dialogs/CreateProjectDialog.tsx')).toMatch(/confirmLabel="Create project"/);
  });

  it('C-29: samples are called Passes', () => {
    for (const p of [
      'features/experiments/launch/evaluation/FieldControl.tsx',
      'features/experiments/launch/model/validation.ts',
    ])
      expect(src(p), p).toContain("=== 'samples' ? 'Passes'");
  });

  it('C-30: one problem, many problems', () => {
    for (const p of [
      'features/live/components/StatusLine.tsx',
      'features/live/components/worker/StatusStrip.tsx',
    ]) {
      expect(src(p), p).toContain("errors === 1 ? 'problem' : 'problems'");
      expect(src(p), p).not.toContain('} problems in the last hour');
    }
  });

  it('C-33: an empty message ends without a full stop', () => {
    const problems: string[] = [];
    for (const f of under(shippedTsx, 'features/')) {
      const t = read(f);
      for (const m of t.matchAll(/\b(empty|emptyState)=(?:"([^"]*)"|\{\s*(['`])([^'`]*)\3\s*\})/g))
        if (/\.$/.test(m[2] ?? m[4] ?? '')) problems.push(`${rel(f)}: ${m[0]}`);
      for (const e of elements(t, ['EmptyState']))
        for (const m of e.attrs.matchAll(/\btitle=(?:"([^"]*)"|\{\s*(['`])([^'`]*)\2\s*\})/g))
          if (/\.$/.test(m[1] ?? m[3] ?? '')) problems.push(`${rel(f)}:${e.line}: ${m[0]}`);
    }
    none(problems);
  });

  it('C-34: an empty panel is an EmptyState, not a muted sentence', () => {
    none(grep(under(shippedTsx, 'features/live/components/turn/'), /tone="muted">No [^<]*\.<\/Text>/));
    none(
      grep(
        under(shippedTsx, 'features/run-detail/components/panels/'),
        /className=\{[a-z]+\.note\}>No [^<]*\.</,
      ),
    );
  });

  it('C-35: an empty chart keeps the chart shape', () => {
    const card = src('features/experiments/detail/ChartCard.tsx');
    expect(card).toMatch(
      /className=\{styles\.chartEmpty\}[\s\S]{0,200}aspectRatio:\s*`\$\{CHART\.width\} \/ \$\{CHART\.height\}`/,
    );
    expect(card).toMatch(/styles\.chartEmpty[\s\S]{0,300}<EmptyState/);
    expect(card).not.toContain('<title>');
    expect(src('features/experiments/detail/detail.module.css')).toContain('.chartEmpty');
    expect(src('ui/Chart/index.ts')).toMatch(/\bTipBody\b/);
  });

  it('C-36: an empty filtered list shows only the title (no echo, no Clear filters)', () => {
    none(grep(noDev, /match current filters|contains \\?"\$\{/));
    for (const p of [
      'features/experiments/list/ExperimentsPage.tsx',
      'features/experiments/queue/QueuePage.tsx',
      'features/feedback/RequestsTable.tsx',
      'features/runs-list/RunsPage.tsx',
      'features/reviews/ReviewsPage.tsx',
      'features/datasets/detail/ItemsTab.tsx',
    ])
      expect(src(p), p).not.toContain('Clear filters');
  });

  it('C-38: a not-found page links back to its parent with the prev icon', () => {
    const es = src('ui/ErrorState/ErrorState.tsx');
    expect(elements(es, ['LinkButton']).some((e) => /name="prev"/.test(e.attrs))).toBe(true);
    const nf = src('features/shell/ProjectNotFound.tsx');
    expect(nf).not.toMatch(/variant="accent">\s*[^<]*Projects/);
    expect(nf).not.toContain('All projects');
    const problems: string[] = [];
    // a trace drawer body has no parent page to link to (spec C-38 exception)
    for (const f of outside(
      under(shippedTsx, 'features/'),
      'features/run-detail/components/traces/TraceDrawer.tsx',
      'features/compare/components/rd/TraceDrawer.tsx',
    ))
      for (const e of elements(read(f), ['ErrorState']))
        if (/notFoundMessage=/.test(e.attrs) && !/\bparent=/.test(e.attrs))
          problems.push(`${rel(f)}:${e.line}`);
    none(problems);
    expect(
      elements(src('features/environments/EnvironmentPanelBody.tsx'), ['ErrorState']).some((e) =>
        /\bparent=/.test(e.attrs),
      ),
    ).toBe(true);
  });

  it('C-39: a table error has a title', () => {
    const problems: string[] = [];
    for (const f of under(shippedTsx, 'features/'))
      for (const e of elements(read(f), ['DataTable']))
        if (/\berror=/.test(e.attrs) && !/\berrorTitle=/.test(e.attrs)) problems.push(`${rel(f)}:${e.line}`);
    none(problems);
  });

  it('C-40: feedback loading frames show no fake id or loading words', () => {
    const t = src('features/feedback/LoadingFrames.tsx');
    for (const s of ['FB-0000', 'Loading…', 'Opening the']) expect(t, s).not.toContain(s);
  });

  it('C-41: no "refreshes automatically" sentence', () => {
    none(grep(noDev, /Refresh(es|ing) automatically/));
  });

  it('C-42: compare notices are InlineNotice', () => {
    const p = 'features/compare/components/Notices.module.css';
    if (exists(p))
      for (const [s, b] of allRules(read(join(SRC, p))))
        if (/\.(note|alert|info)\b/.test(s)) expect(b, s).not.toMatch(/\bborder(-[a-z-]+)?:/);
    expect(src('features/compare/components/Notices.tsx')).toMatch(/import \{[^}]*\bInlineNotice\b/);
  });

  it('C-43: a launch callout is a left-edge notice', () => {
    const css = src('features/experiments/launch/components/launch.module.css');
    const callout = rule(css, '.callout');
    expect(callout).toContain('border-inline-start: 3px solid var(--tone)');
    expect(callout).not.toContain('border: 1px solid');
    expect(css).not.toMatch(/\.callout\[data-tone=[^{]*\{[^}]*border/);
  });

  it('C-44: filters clear through ClearFiltersButton; InlineNotice has info and neutral', () => {
    for (const p of [
      'features/run-detail/components/ItemsSection.tsx',
      'features/compare/components/items/ItemsSection.tsx',
    ])
      expect(src(p), p).not.toContain('Clear filter');
    expect(src('features/run-detail/components/SectionNav.tsx')).toContain('ClearFiltersButton');
    const notice = src('ui/InlineNotice/InlineNotice.tsx');
    expect(notice).toMatch(/'info'/);
    expect(notice).toMatch(/'neutral'/);
    // D-22
    expect(
      elements(src('features/run-detail/components/items/FilterBar.tsx'), ['Chip']).filter((e) =>
        /onRemove=/.test(e.attrs),
      ),
    ).toEqual([]);
    // shim: ScopeBar keeps a deprecated Clear all prop until the cv3-shim removal
    expect(src('ui/ScopeBar/ScopeBar.tsx')).not.toContain('Clear all');
  });

  it('C-45: a note reads as one line; its title is a sentence', () => {
    expect(rule(src('features/datasets/components/Note.module.css'), '.body')).not.toMatch(
      /flex-direction:\s*column/,
    );
    const problems: string[] = [];
    for (const p of [
      'features/datasets/components/ItemStateUi.tsx',
      'features/datasets/detail/BatchDialog.tsx',
      'features/datasets/detail/AccessTab.tsx',
    ])
      for (const e of elements(src(p), ['Note']))
        for (const m of e.attrs.matchAll(/\btitle=(?:"([^"]*)"|\{\s*(['`])([^'`]*)\2\s*\})/g))
          if (!/\.$/.test(m[1] ?? m[3] ?? '')) problems.push(`${p}:${e.line}: ${m[0]}`);
    none(problems);
    const titled = [
      'features/datasets/components/ItemStateUi.tsx',
      'features/datasets/detail/BatchDialog.tsx',
      'features/datasets/detail/AccessTab.tsx',
    ]
      .flatMap((p) => elements(src(p), ['Note']))
      .filter((e) => /\btitle=/.test(e.attrs));
    expect(titled.length).toBeGreaterThan(0);
  });

  it('C-46: the always-access note is a neutral lock notice', () => {
    const notices = elements(src('features/datasets/detail/AccessTab.tsx'), ['InlineNotice']);
    expect(notices.some((e) => /tone="neutral"/.test(e.attrs) && /icon="lock"/.test(e.attrs))).toBe(true);
  });
});

describe('consistency v3: family D (tables, bars, tabs, stats)', () => {
  const noDev = outside(shippedTsx, 'features/dev/');
  const allTsx = all.filter((f) => f.endsWith('.tsx') && !isTest(f));

  it('D-01: zebra stripes always, at one page step and a smaller report step', () => {
    const tokens = read(join(SRC, 'styles/tokens.css'));
    const page = tokens.match(/--stripe-step:\s*([\d.]+)%/);
    const report = tokens.match(/--stripe-step-report:\s*([\d.]+)%/);
    expect(page && report).toBeTruthy();
    expect(Number(report![1])).toBeLessThan(Number(page![1]));
    expect(src('ui/DataTable/DataTable.tsx')).not.toContain('dataRows.length > 8');
    expect(
      rules(src('ui/DataTable/DataTable.module.css'), '.tr[data-zebra]').join('\n') +
        allRules(src('ui/DataTable/DataTable.module.css'))
          .filter(([s]) => s.includes('[data-zebra]'))
          .map(([, b]) => b)
          .join('\n'),
    ).toContain('var(--zebra-step)');
    none(grep(under(noDev, 'features/'), /zebra=\{false\}/));
  });

  it('D-02: report tables share the uppercase header and the report stripe', () => {
    const panel = src('features/compare/components/panel/Panel.module.css');
    const detail = src('features/experiments/detail/detail.module.css');
    const steps = src('features/run-detail/components/latency/Steps.module.css');
    for (const [css, sel] of [
      [panel, '.table thead th'],
      [detail, '.plain th'],
      [steps, '.stepHead'],
      [steps, '.headButton'],
    ] as const) {
      expect(rule(css, sel), sel).toMatch(/text-transform:\s*uppercase/);
      expect(rule(css, sel), sel).toMatch(/letter-spacing:\s*0\.05em/);
    }
    for (const p of [
      'features/compare/components/panel/Panel.module.css',
      'features/compare/components/panel/AveragesMatrix.module.css',
      'features/compare/components/sweep/SweepView.module.css',
      'features/experiments/detail/detail.module.css',
      'features/run-detail/components/latency/Steps.module.css',
    ])
      expect(src(p), p).toContain('var(--stripe-step-report)');
    expect(rule(steps, '.num')).not.toMatch(/text-align:\s*right/);
    expect(rule(panel, '.table th')).not.toContain('text-transform');
  });

  it('D-03: admin and profile tables use the default density', () => {
    none(grep(under(noDev, 'features/admin/'), /density="compact"/));
    expect(src('features/shell/profile/ProfilePage.tsx')).not.toContain('cell={5}');
  });

  it('D-04: a dataset metrics table has no group band', () => {
    for (const p of ['features/datasets/detail/RunsTab.tsx', 'features/datasets/item/ItemRunsTab.tsx'])
      expect(src(p), p).toContain('groupBand={false}');
  });

  it('D-05: a wrapped cell has no block padding; the input cell is a prompt preview', () => {
    expect(rule(src('ui/DataTable/DataTable.module.css'), '.cell[data-wrap]')).toMatch(/padding-block:\s*0/);
    const t = src('features/run-detail/components/items/ItemsTable.tsx');
    expect(t).toContain('promptPreview(title)');
    expect(t).not.toContain(".replace(/\\s+/g, ' ')");
  });

  it('D-06: a live turn reason is one line', () => {
    const css = src('features/live/turns.module.css');
    expect(rule(css, ".reason[dir='auto']")).toMatch(/-webkit-line-clamp:\s*1/);
    expect(rule(css, '.oneLine')).toMatch(/white-space:\s*nowrap/);
    const t = src('features/live/components/TurnsTable.tsx');
    expect(t).toContain('styles.oneLine');
    expect(t).not.toContain("align: 'end'");
  });

  it('D-09: worker problems and jobs are embedded tables with bar filters', () => {
    const p = src('features/live/components/worker/ProblemsBlock.tsx');
    expect(p).not.toMatch(/import \{[^}]*\bChip\b/);
    expect(elements(p, ['DataTable']).some((e) => /variant="embedded"/.test(e.attrs))).toBe(true);
    expect(elements(p, ['MultiSelect']).filter((e) => /triggerVariant="bar"/.test(e.attrs)).length).toBe(2);
    expect(src('features/live/worker.module.css')).not.toMatch(/\.problem\b/);
    expect(
      elements(src('features/live/components/worker/JobsBlock.tsx'), ['DataTable']).some((e) =>
        /variant="embedded"/.test(e.attrs),
      ),
    ).toBe(true);
    // E-15
    expect(src('features/experiments/detail/MatrixCard.tsx')).not.toContain('<Card flush');
  });

  it('D-10: a table footer says what the range hides through filterNote, not a summary', () => {
    const parts = src('ui/DataTable/parts.tsx');
    const fp = parts.slice(parts.indexOf('FooterProps'), parts.indexOf('}', parts.indexOf('FooterProps')));
    expect(fp).toContain('filterNote');
    const footers = allTsx.flatMap((f) =>
      elements(read(f), ['DataTable.Footer']).map((e) => ({ f: rel(f), e })),
    );
    none(footers.filter(({ e }) => hasProp(e.attrs, 'summary')).map(({ f, e }) => `${f}:${e.line}`));
    expect(src('features/admin/runs/RunTables.tsx')).not.toContain('footerSummary');
    const queue = src('features/experiments/queue/QueuePage.tsx');
    expect(queue).not.toContain('Refreshes automatically');
    expect(rule(src('ui/DataTable/DataTable.module.css'), '.footer')).toMatch(
      /grid-template-columns:\s*1fr auto 1fr/,
    );
    const qf = elements(queue, ['DataTable.Footer'])
      .map((e) => propValue(e.attrs, 'filterNote') ?? '')
      .join('\n');
    expect(qf).toContain('Showing the first');
    const items = elements(src('features/datasets/detail/ItemsTab.tsx'), ['DataTable.Footer'])
      .map((e) => propValue(e.attrs, 'filterNote') ?? '')
      .join('\n');
    expect(items).toContain("route.state === 'disabled'");
    expect(items).toContain('version.item_count');
    expect(src('features/live/components/TurnsTable.tsx')).not.toContain('filterNote');
    expect(src('features/admin/runs/RunTables.tsx')).not.toContain('filterNote');
    // shim: FooterProps keeps a deprecated summary until the cv3-shim removal
    expect(fp).not.toMatch(/\bsummary\??:/);
  });

  it('D-11: a list count shows only in the footer range (no Toolbar count)', () => {
    const toolbars = allTsx.flatMap((f) =>
      elements(read(f), ['DataTable.Toolbar']).map((e) => ({ f: rel(f), e })),
    );
    none(toolbars.filter(({ e }) => hasProp(e.attrs, 'count')).map(({ f, e }) => `${f}:${e.line}`));
    // shim: ToolbarProps keeps a deprecated count until the cv3-shim removal
    const parts = src('ui/DataTable/parts.tsx');
    const tp = parts.slice(
      parts.indexOf('ToolbarProps'),
      parts.indexOf('\n}', parts.indexOf('ToolbarProps')),
    );
    expect(tp).not.toMatch(/\bcount\??:/);
  });

  it('D-15: a page header holds no search', () => {
    for (const p of [
      'features/shell/projects/ProjectsPage.tsx',
      'features/datasets/catalog/CatalogPage.tsx',
    ]) {
      const t = src(p);
      for (const e of elements(t, ['PageHeader']))
        expect(propValue(e.attrs, 'actions') ?? '', p).not.toContain('<SearchField');
    }
  });

  it('D-16: list toolbars use bar Selects and the shared clear button', () => {
    none(grep(outside(shippedCss, 'ui/ClearFiltersButton/'), /\.clearCount\b/));
    for (const p of [
      'features/experiments/list/ExperimentsPage.tsx',
      'features/experiments/queue/QueuePage.tsx',
    ])
      expect(src(p), p).not.toMatch(/import \{[^}]*\bCheckbox\b/);
    const problems: string[] = [];
    for (const f of under(noDev, 'features/'))
      for (const tb of elements(read(f), ['DataTable.Toolbar'])) {
        const rows = propValue(tb.attrs, 'rows') ?? '';
        for (const s of elements(rows, ['Select']))
          if (!/triggerVariant="bar"/.test(s.attrs)) problems.push(`${rel(f)}:${tb.line}`);
      }
    none(problems);
    expect(src('ui/Select/Select.tsx')).toMatch(/import \{[^}]*\bBarTrigger\b/);
  });

  it('D-17: feedback list filters without a segmented control', () => {
    expect(src('features/feedback/FeedbackListPage.tsx')).not.toMatch(/import \{[^}]*\bSegmentedControl\b/);
  });

  it('D-18: the project filter is a bar Select with a clear button', () => {
    for (const p of ['features/trash/TrashPage.tsx', 'features/admin/runs/RunsTab.tsx']) {
      const t = src(p);
      const sel = elements(t, ['Select']).filter((e) => /label="Project"/.test(e.attrs));
      expect(sel.length, p).toBeGreaterThan(0);
      for (const e of sel) {
        expect(e.attrs, p).toContain('triggerVariant="bar"');
        expect(e.attrs, p).not.toContain('placeholder="All projects"');
      }
      expect(t, p).toContain('<ClearFiltersButton');
    }
  });

  it('D-20: the reviews confidence filter is a BarTrigger', () => {
    const t = src('features/reviews/FilterBar.tsx');
    expect(elements(t, ['BarTrigger']).some((e) => /label="Confidence"/.test(e.attrs))).toBe(true);
    expect(t).not.toContain('<Button');
  });

  it('D-24: there is one tab look (no dense tabs)', () => {
    expect(src('ui/Tabs/Tabs.module.css')).not.toMatch(/data-variant=['"]dense['"]/);
    const problems: string[] = [];
    for (const f of all.filter((x) => x.endsWith('.tsx') && !isTest(x)))
      for (const e of elements(read(f), ['Tabs']))
        if (/variant="dense"/.test(e.attrs)) problems.push(`${rel(f)}:${e.line}`);
    none(problems);
    // shim: Tabs.tsx keeps a deprecated variant prop until the cv3-shim removal
    const tabs = src('ui/Tabs/Tabs.tsx');
    expect(tabs).not.toContain('dense');
    expect(tabs).not.toMatch(/\bvariant\??:/);
  });

  it('D-25: a vertical tab marks the selection with a green start edge', () => {
    const css = src('ui/Tabs/Tabs.module.css');
    expect(
      allRules(css).some(
        ([s, b]) => /data-orientation=['"]vertical['"]/.test(s) && /border-inline-start/.test(b),
      ),
    ).toBe(true);
    expect(rule(css, ".tabs[data-orientation='vertical'] > .list > .tab[data-selected]")).toMatch(
      /border-inline-start-color:\s*var\(--accent-primary\)/,
    );
    expect(
      rule(src('features/shell/settings/settings.module.css'), ".promptTab[aria-selected='true']"),
    ).not.toMatch(/background/);
  });

  it('D-26: count tiles trim their text box; the compare nav marks the section without a fill', () => {
    for (const p of [
      'ui/Tabs/Tabs.module.css',
      'ui/MultiSelect/MultiSelect.module.css',
      'features/run-detail/components/SectionNav.module.css',
      'features/compare/components/ReportSections.module.css',
    ])
      expect(rule(src(p), '.count'), p).toContain('text-box: trim-both cap alphabetic');
    expect(
      rule(src('features/compare/components/ReportSections.module.css'), '.link[aria-current]'),
    ).not.toMatch(/background/);
  });

  it('D-27: the live trend chart names its window in titleMeta', () => {
    const t = src('features/live/components/TrendChart.tsx');
    expect(t).not.toContain('14 days');
    expect(t).not.toContain('UTC');
    expect(t).not.toMatch(/\bcaption=/);
    expect(t).toContain('titleMeta=');
    expect(src('features/run-detail/components/charts/ChartCard.tsx')).toMatch(/titleMeta\?:/);
  });

  it('D-28: dataset access picks a level without a segmented control', () => {
    expect(src('features/datasets/detail/AccessTab.tsx')).not.toMatch(/import \{[^}]*\bSegmentedControl\b/);
  });

  it('D-29: stat values are not tinted; a mini strip is transparent', () => {
    const css = src('ui/StatStrip/StatStrip.module.css');
    for (const [s, b] of allRules(css))
      if (/\.value\b/.test(s)) expect(b, s).not.toMatch(/color:\s*var\(--tone-text\)/);
    for (const p of ['features/admin/AdminPage.tsx', 'features/runs-list/OverviewPage.tsx'])
      expect(src(p), p).not.toContain("tone: 'accent'");
    const admin = src('features/admin/AdminPage.tsx');
    expect(admin).not.toContain('All active');
    expect(admin).not.toContain('None archived');
    expect(src('features/compare/components/RunCards.tsx')).not.toMatch(/function Stat\b/);
    expect(rule(css, ".strip[data-variant='mini']")).toMatch(/background:\s*transparent/);
    expect(rule(css, ".strip[data-variant='mini'] .label")).toMatch(/color:\s*var\(--text-muted\)/);
    const health = src('features/live/components/ServiceHealth.tsx');
    expect(health).toContain('<StatStrip');
    expect(health).not.toMatch(/import \{[^}]*\bLink\b/);
    expect(src('features/live/components/turn/TurnTiles.tsx')).not.toMatch(/import \{[^}]*\bStatTiles\b/);
  });

  it('D-30: feedback pages draw no stat strip; level 2 is a warning', () => {
    for (const p of ['features/feedback/RequestPage.tsx', 'features/feedback/LoadingFrames.tsx'])
      expect(src(p), p).not.toMatch(/import \{[^}]*\bStatStrip\b/);
    expect(rule(src('features/feedback/badges.module.css'), ".levels[data-level='2']")).toMatch(
      /--level-color:\s*var\(--warning\)/,
    );
  });

  it('D-31: key-value labels are not uppercase', () => {
    expect(rule(src('ui/KeyValueGrid/KeyValueGrid.module.css'), '.label')).not.toMatch(
      /text-transform:\s*uppercase/,
    );
    expect(rule(src('features/run-detail/components/RunHero.module.css'), '.factLabel')).not.toContain(
      'text-transform',
    );
    expect(src('features/environments/EnvironmentSections.tsx')).not.toContain('<dl className={styles.kv}>');
    expect(rule(src('features/reviews/DetailPane.module.css'), '.previewLabel')).not.toContain(
      'text-transform',
    );
  });

  it('D-34: the runs trend tooltip is TipBody', () => {
    const t = src('features/runs-list/TrendChart.tsx');
    expect(t).toMatch(/import \{[^}]*\bTipBody\b/);
    expect(t).not.toContain('tipRow');
  });

  it('D-35: the response panel has no fade gradient', () => {
    expect(src('features/run-detail/components/latency/Response.module.css')).not.toContain(
      'linear-gradient(to bottom',
    );
  });

  it('D-37: a matrix cell has a transparent background', () => {
    expect(rule(src('features/run-detail/components/charts/Charts.module.css'), '.matrixCell')).toMatch(
      /background:\s*transparent/,
    );
  });
});

describe('consistency v3: family E (pages, dialogs, forms, layout)', () => {
  const noDev = outside(shippedTsx, 'features/dev/');
  /** The text of the <tag> element that starts at `at`, up to its balanced close. */
  const balanced = (text: string, at: number, tag: string) => {
    const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
    re.lastIndex = at;
    let depth = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      depth += m[0].startsWith('</') ? -1 : 1;
      if (depth === 0) return text.slice(at, m.index + m[0].length);
    }
    return text.slice(at);
  };
  const dialogTitles = (t: string) =>
    [...t.matchAll(/\btitle=(\{`[^`]*`\}|"[^"]*"|\{'[^']*'\})/g)].map((m) => m[1]!);

  it('E-01: the compare title row holds the title and Export HTML, not the baseline picker', () => {
    const t = src('features/compare/ComparePage.tsx');
    const at = t.lastIndexOf('<div', t.indexOf('className={styles.titleRow}'));
    const row = balanced(t, at, 'div');
    expect(row).toContain('data-testid="compare-title"');
    expect(row).toContain('Export HTML');
    expect(row).not.toContain('<BaselineSelect');
  });

  it('E-02: the overview page is titled Dashboard', () => {
    const t = src('features/runs-list/OverviewPage.tsx');
    expect(t).toContain('title="Dashboard"');
    expect(t).not.toContain('title={project.name}');
  });

  it('E-07: the turn header links out with the external icon', () => {
    const t = src('features/live/components/turn/TurnHeader.tsx');
    expect(t).not.toContain('↗');
    expect(t).not.toContain('utcTime');
    none(grep(noDev, /↗/));
    expect(t.split('name="external"').length - 1).toBeGreaterThanOrEqual(2);
    expect(rule(src('features/live/turn.module.css'), '.traceLink')).toMatch(/display:\s*inline-flex/);
  });

  it('E-09: dataset settings save through SaveFooter', () => {
    const t = src('features/datasets/detail/SettingsTab.tsx');
    expect(t).not.toContain('FieldRow');
    for (const e of elements(t, ['Card'])) {
      expect(e.attrs).not.toContain('variant="lg"');
      expect(e.attrs).not.toContain('tone="danger"');
    }
    expect(t).toContain('<SaveFooter');
  });

  it('E-10: a settings card saves with one "Save" in SaveFooter', () => {
    const words = /^Save (changes|access|connection|behaviour|groups|rules)$/;
    const problems: string[] = [];
    for (const f of noDev) {
      if (rel(f) === 'features/datasets/item/ItemPage.tsx') continue;
      for (const b of elements(read(f), ['Button']))
        if (words.test(b.text)) problems.push(`${rel(f)}:${b.line}: ${b.text}`);
    }
    none(problems);
    none(grep(noDev, /label: 'Save rules'/));
    expect(src('features/datasets/detail/AccessTab.tsx')).not.toContain('saveBar');
    const card = src('features/shell/settings/SettingsCard.tsx');
    const props = card.slice(
      card.indexOf('interface SaveFooterProps'),
      card.indexOf('\n}', card.indexOf('interface SaveFooterProps')),
    );
    expect(props).toContain('isDisabled?: boolean');
    expect(props).toContain('disabledReason?: string');
    for (const p of [
      'features/analyzer/guidance/DiagnosisPanel.tsx',
      'features/datasets/detail/ItemPane.tsx',
    ])
      expect(src(p), p).toContain('<SaveFooter');
  });

  it('E-11: environment settings save in SaveFooter, with a danger zone', () => {
    for (const [s, b] of allRules(src('features/environments/EnvironmentPage.module.css')))
      if (/\.footer\b/.test(s)) expect(b, s).not.toMatch(/position:\s*sticky/);
    const form = src('features/environments/SettingsForm.tsx');
    expect(form).toContain('<SaveFooter');
    expect(form).toContain('Danger zone');
  });

  it('E-13: the remote queue is a Section', () => {
    const t = src('features/experiments/queue/RemoteQueueSection.tsx');
    expect(t).toMatch(/import \{[^}]*\bSection\b/);
    expect(t).toContain('id="remote-queue"');
    expect(t).not.toContain('<button');
  });

  // Owner decision pending (PR 62 x PR 64 merge): the launch environments keep the round 9 option box
  // (DESIGN_LANGUAGE "Option box"), so the E-14 striped plain rows are not enforced here.
  it('E-14: the environment picker shows health as a mark, not a bordered tag', () => {
    const t = src('features/experiments/launch/entry/EnvironmentPicker.tsx');
    expect(t).not.toContain('Healthy</Tag>');
    expect(t).not.toContain('variant="ghost"');
  });

  it('E-16: quick filter panels have a large title and a close button', () => {
    for (const p of [
      'features/run-detail/components/QuickFilters.tsx',
      'features/compare/components/QuickFilters.tsx',
    ]) {
      const t = src(p);
      expect(t, p).toMatch(/label="Hide quick filters"\s+icon="close"/);
      expect(
        elements(t, ['Text']).some((e) => /variant="lg"/.test(e.attrs)),
        p,
      ).toBe(true);
    }
  });

  it('E-17: deleting a named thing asks for its name', () => {
    const docs = elements(src('features/analyzer/guidance/DocumentsPanel.tsx'), ['ConfirmDialog']).filter(
      (e) => /Delete document\?/.test(e.attrs),
    );
    expect(docs.length).toBeGreaterThan(0);
    for (const e of docs) expect(e.attrs).toContain('requireText');
    expect(src('features/datasets/detail/SettingsTab.tsx')).toContain('requireText={dataset.name}');
    const env = elements(src('features/environments/SettingsForm.tsx'), ['ConfirmDialog']).filter((e) =>
      /confirmLabel="Delete environment"/.test(e.attrs),
    );
    expect(env.length).toBeGreaterThan(0);
    for (const e of env) expect(e.attrs).toContain('requireText={env.name}');
  });

  it('E-18: decision dialogs ask a question', () => {
    expect(src('features/reviews/ReviewsPage.tsx')).toContain('title="Reject this issue?"');
    expect(src('features/experiments/detail/useExperimentFlows.tsx')).toContain('title="Save as a preset?"');
    expect(src('features/analyzer/guidance/VersionDialogs.tsx')).toContain(
      'title={`Publish v${version.version}?`}',
    );
    expect(src('features/datasets/components/dialogs.tsx')).toContain(
      'title={`Publish ${version.version}?`}',
    );
    expect(src('features/live/components/worker/DateRangeDialog.tsx')).toContain(
      'title="Backfill these days?"',
    );
  });

  it('E-20: leave-page dialogs use the one shared title', () => {
    none(
      grep(
        noDev,
        /Leave this page\?|Leave without publishing\?|Leave without launching\?|Discard access changes\?|Discard the unsaved changes\?/,
      ),
    );
  });

  it('E-21: an information dialog uses the default width', () => {
    const problems: string[] = [];
    for (const f of noDev)
      for (const e of elements(read(f), ['Dialog']))
        if (
          /size="sm"/.test(e.attrs) &&
          dialogTitles(e.attrs).some((t) => /Keyboard shortcuts|errors|Errors/.test(t))
        )
          problems.push(`${rel(f)}:${e.line}`);
    none(problems);
    expect(
      elements(src('features/runs-list/ShortcutsDialog.tsx'), ['Dialog']).some((e) =>
        /size="sm"/.test(e.attrs),
      ),
    ).toBe(false);
  });

  it('E-22: a drawer is 360px or 560px wide', () => {
    const problems: string[] = [];
    for (const f of noDev)
      for (const e of elements(read(f), ['Drawer']))
        for (const m of e.attrs.matchAll(/\bwidth=\{(\d+)\}/g))
          if (!['360', '560'].includes(m[1]!)) problems.push(`${rel(f)}:${e.line}: ${m[1]}`);
    none(problems);
  });

  it('E-24: required and optional are marked, never written in brackets', () => {
    expect(src('ui/Textarea/Textarea.tsx')).toContain('fieldStyles.required');
    none(grep(noDev, /\((required|optional)\)|(placeholder|help)=["{'`]*Optional["'`}]/));
  });

  it('E-25: launch settings use the ui form primitives', () => {
    none(grep(under(shippedTsx, 'features/experiments/launch/'), /<(select|textarea|input)\b/));
  });

  it('E-30: no typed decision glyphs', () => {
    none(grep(noDev, /◆/));
    const rail = src('features/run-detail/components/items/PassRail.tsx');
    expect(rail).not.toContain('✓');
    expect(rail).not.toContain('✕');
    expect(src('features/run-detail/components/analysis/MetricAnalysisCards.tsx')).not.toContain('✓ Approve');
    expect(src('features/compare/components/items/OutputCard.tsx')).not.toContain('★ Best');
  });

  it('E-32: no native details/summary outside the docs', () => {
    none(grep(outside(noDev, 'features/docs/'), /<details\b/));
    none(
      grep(
        outside(shippedCss, 'features/docs/').filter((f) => f.endsWith('.module.css')),
        /(^|[\s,>+~])summary\s*[{:]/m,
      ),
    );
  });

  it('E-33: a button icon beside text is 12px', () => {
    const problems: string[] = [];
    for (const f of noDev)
      for (const b of buttons(read(f))) {
        if (!b.text) continue;
        for (const prop of ['icon', 'iconEnd']) {
          const v = propValue(b.attrs, prop);
          if (!v || !/^\s*<Icon\b/.test(v) || /name="more"/.test(v)) continue;
          if (!/size=\{12\}/.test(v)) problems.push(`${rel(f)}:${b.line}: ${prop} ${v.trim()}`);
        }
      }
    none(problems);
  });

  it('E-35: body text weight is 450', () => {
    expect(rule(src('ui/Text/Text.module.css'), '.text')).toContain('font-weight: 450');
  });

  it('E-37: table counts and lineage meta are sans', () => {
    expect(rule(src('ui/DataTable/DataTable.module.css'), '.selCount')).not.toContain('font-mono');
    const lin = src('features/datasets/detail/LineageTab.module.css');
    expect(rule(lin, '.meta')).not.toContain('font-mono');
    expect(rule(lin, '.dates')).not.toContain('font-mono');
  });

  it('E-38: a stat label is 600 secondary', () => {
    const label = rule(src('ui/StatStrip/StatStrip.module.css'), '.label');
    expect(label).toMatch(/font-weight:\s*600/);
    expect(label).toMatch(/color:\s*var\(--text-secondary\)/);
  });

  it('E-40: the queue page uses StatStrip', () => {
    const t = src('features/experiments/queue/QueuePage.tsx');
    expect(t).toContain('<StatStrip');
    expect(t).not.toContain('function Stat(');
  });

  it('E-42: pages share one width and padding (no narrow container)', () => {
    const layout = src('features/shell/layout.module.css');
    expect(layout).not.toMatch(/\.narrow\b/);
    expect(layout).not.toContain('margin: 0 auto');
    const pad = (s: string) => (rule(layout, s).match(/padding[^;]*;/g) ?? []).join(' ');
    expect(pad('.fullWidth')).toBe(pad('.constrained'));
    expect(read(join(SRC, 'styles/tokens.css'))).not.toContain('--page-narrow-w');
    expect(rule(src('features/runs-list/ChartsPage.module.css'), '.screen')).toMatch(
      /padding:\s*var\(--space-lg\)/,
    );
    expect(src('features/runs-list/OverviewPage.module.css')).not.toContain('margin: 0 auto');
    expect(src('features/analyzer/analyzer.module.css')).not.toContain('margin-inline: auto');
    // shim: shell/layout.ts keeps a deprecated narrow container until the cv3-shim removal
    expect(src('features/shell/layout.ts')).not.toMatch(/export const narrow\b/);
  });

  it('E-43: page sections sit --space-lg apart', () => {
    const lg = /gap:\s*var\(--space-lg\)/;
    const checks: [string, string[]][] = [
      ['features/feedback/feedback.module.css', ['.page', '.stackCol', '.split']],
      ['features/live/worker.module.css', ['.grid', '.settingsRow']],
      ['features/live/live.module.css', ['.page']],
      ['features/datasets/detail/SettingsTab.module.css', ['.grid', '.side']],
    ];
    for (const [p, sels] of checks) for (const s of sels) expect(rule(src(p), s), `${p} ${s}`).toMatch(lg);
  });

  it('E-45: a project card wraps its name and pins its role tag', () => {
    const t = src('features/shell/projects/ProjectsPage.tsx');
    const card = fnBody(t, 'ProjectCard');
    expect(card).toContain('<');
    expect(card).not.toContain('truncate');
    expect(rule(src('features/shell/projects/ProjectsPage.module.css'), '.role')).toMatch(
      /align-self:\s*flex-start/,
    );
  });

  it('E-46: run hero facts wrap and spread', () => {
    const css = src('features/run-detail/components/RunHero.module.css');
    const facts = rule(css, '.facts');
    expect(facts).toMatch(/grid-template-columns:\s*repeat\(7, auto\)/);
    expect(facts).toMatch(/justify-content:\s*space-between/);
    const value = rule(css, '.factValue');
    expect(value).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(value).not.toMatch(/white-space:\s*nowrap/);
    expect(value).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('E-47: a run name wraps in the runs table', () => {
    const t = src('features/runs-list/cells.tsx');
    const body = fnBody(t, 'RunNameCell');
    expect(elements(body, ['RunName']).some((e) => /className=\{styles\.runNameWrap\}/.test(e.attrs))).toBe(
      true,
    );
    const css = src('features/runs-list/cells.module.css');
    const wrap = rule(css, '.runName > .runNameWrap');
    expect(wrap).toMatch(/white-space:\s*normal/);
    expect(wrap).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(css, '.runLink')).not.toMatch(/text-overflow:\s*ellipsis/);
  });

  it('E-48: focus is the green ring', () => {
    none(grep(shippedCss, /outline:\s*var\(--focus-ring\)/));
    const row = rule(src('features/reviews/ReviewRow.module.css'), '.row:has(.main:focus-visible)');
    expect(row).toMatch(/outline:\s*2px solid var\(--accent-primary\)/);
    expect(row).toMatch(/outline-offset:\s*-2px/);
  });

  it('E-49: a focused row draws its edge past folded and collapsed cells', () => {
    const css = src('ui/DataTable/DataTable.module.css');
    expect(rule(css, '.tr:focus-visible td[data-collapsed] + td')).toContain(
      'inset 2px 0 0 var(--accent-primary)',
    );
    expect(
      rule(css, '.bodyHost[data-scroll-end] .tr:focus-visible .td[data-fold]:not(:has(.fold[data-open]))'),
    ).toContain('inset -2px 0 0 var(--accent-primary)');
  });

  it('E-52: live day numbers are a StatStrip with green hover links', () => {
    const t = src('features/live/components/DayNumbers.tsx');
    expect(t).toContain('StatStrip');
    expect(t).not.toContain('StatTiles');
    expect(t).not.toContain('data-tone');
    const css = src('features/live/live.module.css');
    expect(rule(css, '.tiles a:hover')).toMatch(/color:\s*var\(--accent-primary\)/);
    expect(css).not.toMatch(/\.tiles a\[data-tone/);
  });
});
