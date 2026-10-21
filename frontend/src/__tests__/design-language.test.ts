/**
 * Port of tests/platform/test_design_language.py for frontend/ (brief 02 §8.2).
 * Enforces docs/DESIGN_LANGUAGE.md over src/**: tokens-only typography, the
 * text-colour ramp, mono-for-data, themed surfaces, and the primitive
 * module contracts. Read the doc before "fixing" a rule here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(SRC, '..');

const read = (p: string) => readFileSync(p, 'utf-8');
const rel = (p: string) => relative(SRC, p);
const cssFiles = fg.sync('**/*.css', { cwd: SRC, absolute: true, ignore: ['**/node_modules/**'] });
const tsxFiles = fg.sync('**/*.{ts,tsx}', {
  cwd: SRC,
  absolute: true,
  ignore: ['**/node_modules/**', '**/__tests__/**'],
});

const FONT_SIZE_CSS = /font-size:\s*([\d.]+)px/g;
const FONT_SIZE_JSX = /fontSize:\s*['"`]?([\d.]+)(?:px)?['"`]?/g;

/**
 * Frozen inventory of hardcoded pixel font sizes, keyed by path relative to
 * src/. Starts EMPTY: decorative glyphs use --glyph-* tokens. Adding an entry
 * is a deliberate design-language exemption; name it in the commit message.
 */
const FROZEN_HARDCODED_SIZES: Record<string, string[]> = {};

function count(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of list) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

describe('typography tokens', () => {
  it('has no hardcoded font sizes outside the frozen allowlist', () => {
    const problems: string[] = [];
    for (const file of [...cssFiles, ...tsxFiles]) {
      const text = read(file);
      const found = [...text.matchAll(FONT_SIZE_CSS), ...text.matchAll(FONT_SIZE_JSX)].map((m) => m[1]!);
      const allowed = count(FROZEN_HARDCODED_SIZES[rel(file)] ?? []);
      const extra = [...count(found)].filter(([size, n]) => n > (allowed.get(size) ?? 0));
      if (extra.length) problems.push(`${rel(file)}: ${extra.map(([s, n]) => `${s}px×${n}`).join(', ')}`);
    }
    expect(problems, 'Use var(--font-*) tokens (docs/DESIGN_LANGUAGE.md §1)').toEqual([]);
  });

  it('keeps the frozen inventory honest (ratchet)', () => {
    for (const [file, sizes] of Object.entries(FROZEN_HARDCODED_SIZES)) {
      const text = read(join(SRC, file));
      const found = count(
        [...text.matchAll(FONT_SIZE_CSS), ...text.matchAll(FONT_SIZE_JSX)].map((m) => m[1]!),
      );
      for (const [size, n] of count(sizes))
        expect(found.get(size) ?? 0, `${file} lost ${size}px`).toBeGreaterThanOrEqual(n);
    }
  });

  it('carries every pinned token verbatim in tokens.css', () => {
    const css = read(join(SRC, 'styles/tokens.css'));
    for (const decl of [
      '--text-primary: #ededf0',
      '--text-secondary: #a8a8ba',
      '--text-muted: #9a9ab2',
      '--text-dim: #6b6b80',
      '--font-xs: 10px',
      '--font-sm: 11px',
      '--font-base: 12px',
      '--font-md: 13px',
      '--font-lg: 15px',
      '--font-xl: 18px',
      '--font-title: 22px',
      '--font-stat: 26px',
      '--accent-tertiary-soft: #c084fc',
      '--control-height: 24px;',
      'color-scheme: dark;',
      "font-family: 'Qym Arabic';",
      'line-height: 1.7;',
      'Menlo',
    ]) {
      expect(css, `tokens.css lost '${decl}'`).toContain(decl);
    }
    const shell = read(join(SRC, 'styles/shell.css'));
    for (const decl of ['--shell-font-sm: 13px', '--shell-font-md: 15px']) expect(shell).toContain(decl);
  });

  it('self-hosts the Plex faces and nothing else', () => {
    const css = read(join(SRC, 'styles/tokens.css'));
    expect(css).toMatch(/--font-sans:\s*'Qym Sans', 'Qym Arabic', 'Qym Sans Fallback'/);
    expect(css).toMatch(/--font-mono:\s*'Qym Mono', 'Qym Arabic', 'Qym Mono Fallback'/);
    expect(css).toContain('font-display: swap');
    expect(css).toContain('size-adjust');
    const families = new Set(
      [...css.matchAll(/@font-face\s*\{\s*font-family:\s*'([^']+)'/g)].map((m) => m[1]),
    );
    expect([...families].sort()).toEqual(
      ['Qym Arabic', 'Qym Mono', 'Qym Mono Fallback', 'Qym Sans', 'Qym Sans Fallback'].sort(),
    );
    const dir = join(SRC, 'styles/fonts');
    const files = readdirSync(dir);
    const woff2 = files.filter((f) => f.endsWith('.woff2'));
    expect(woff2.length).toBeGreaterThan(0);
    for (const f of woff2) expect(css, `${f} is not referenced by tokens.css`).toContain(`./fonts/${f}`);
    expect(
      files.filter((f) => f.startsWith('OFL')).length,
      'a licence file per family',
    ).toBeGreaterThanOrEqual(3);
    const total = woff2.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
    expect(total, 'font payload budget (bytes)').toBeLessThan(200_000);
    // no component names a family of its own
    const problems = cssFiles
      .filter((f) => rel(f) !== 'styles/tokens.css')
      .filter((f) => /font-family:\s*(?![\s]|var\(|inherit)/.test(read(f)))
      .map((f) => rel(f));
    expect(problems).toEqual([]);
  });

  it('defines the shared scale in one place only', () => {
    const scoped =
      /^\s*(--font-(?:xs|sm|base|md|lg|xl|title|stat)|--text-(?:primary|secondary|muted|dim)|--bg-[\w-]+|--control-height):/gm;
    for (const file of cssFiles) {
      const name = rel(file);
      if (name === 'styles/tokens.css') continue;
      expect(
        [...read(file).matchAll(scoped)].map((m) => m[1]),
        `${name} redefines a shared token`,
      ).toEqual([]);
    }
  });
});

describe('colour ramp', () => {
  it('bans old greys, webfonts and the hex values that became tokens', () => {
    const banned: Record<string, string> = {
      '#7a7a90': 'old --text-muted',
      '#50505e': 'old --text-dim',
      'DM Sans': 'removed webfont',
      Georgia: 'removed serif',
      'fonts.googleapis.com': 'no webfont imports',
      '#00e6b8': 'use var(--accent-primary-hover)',
      '#dc2626': 'use var(--error-hover)',
      '#94a3b8': 'legacy status grey',
      '@fontsource': 'no webfonts',
    };
    const files = [...cssFiles, ...tsxFiles, join(FRONTEND, 'index.html'), join(FRONTEND, 'package.json')];
    const problems: string[] = [];
    for (const file of files) {
      const text = read(file).toLowerCase();
      for (const [needle, why] of Object.entries(banned)) {
        if (file.endsWith('tokens.css') && (needle === '#00e6b8' || needle === '#dc2626')) continue;
        if (text.includes(needle.toLowerCase()))
          problems.push(`${relative(FRONTEND, file)}: '${needle}' (${why})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never puts --text-dim on readable content', () => {
    const allowed = /placeholder|disabled|aria-disabled|glyph|icon|arrow|sep|decorative|dim/i;
    const problems: string[] = [];
    for (const file of cssFiles) {
      const text = read(file);
      for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = block[1]!.trim().split('}').pop()!.trim();
        const body = block[2]!;
        for (const line of body.split('\n')) {
          if (!/color:\s*var\(--text-dim\)/.test(line)) continue;
          if (allowed.test(selector) || /\/\*.*(decorative|placeholder|disabled).*\*\//i.test(line)) continue;
          problems.push(`${rel(file)}: '${selector.split('\n').pop()!.trim()}' uses --text-dim`);
        }
      }
      expect(text, `${rel(file)}: table header rule uses --text-dim`).not.toMatch(
        /(?:thead\s+th|\bth)\s*\{[^}]*color:\s*var\(--text-dim\)/s,
      );
    }
    expect(problems).toEqual([]);
  });
});

describe('surfaces are themed', () => {
  it('declares the dark colour scheme in tokens.css and index.html', () => {
    expect(read(join(SRC, 'styles/tokens.css'))).toMatch(/:root\s*\{[^}]*color-scheme: dark;/s);
    expect(read(join(FRONTEND, 'index.html'))).toContain('<meta name="color-scheme" content="dark" />');
  });

  it('paints no surface raw white', () => {
    const raw = /background(?:-color)?\s*:\s*(?:#fff\b|#ffffff\b|white\b)/i;
    const jsx = /background(?:Color)?:\s*['"](?:#fff\b|#ffffff\b|white\b)/i;
    for (const file of cssFiles) expect(read(file), rel(file)).not.toMatch(raw);
    for (const file of tsxFiles) expect(read(file), rel(file)).not.toMatch(jsx);
  });
});

describe('primitive module contracts', () => {
  const ui = (name: string) => read(join(SRC, 'ui', name, `${name}.module.css`));
  const contracts: Record<string, string[]> = {
    Button: [
      'height: var(--control-height)',
      'border-radius: var(--control-radius)',
      'background: var(--accent-primary)',
      'var(--error)',
    ],
    IconButton: [
      'width: var(--control-height)',
      'height: var(--control-height)',
      'border: 0',
      'border-radius: var(--control-radius)',
      'background: transparent',
      'color: var(--accent-primary)',
    ],
    TextField: [
      'height: var(--control-height)',
      'border-radius: var(--control-radius)',
      'min-height: 42px',
      'font-size: var(--font-md)',
      'padding-inline-start: 26px',
    ],
    Select: ['height: var(--control-height)', 'min-height: var(--dropdown-option-height)'],
    MultiSelect: ['min-height: var(--dropdown-option-height)', 'width: var(--dropdown-width)'],
    RadioGroup: ['min-block-size: var(--row-comfortable)', 'var(--accent-primary)', '[data-selected]'],
    SegmentedControl: ['height: var(--control-height)', 'background: var(--accent-primary)', 'height: 100%'],
    Pagination: ['height: var(--control-height)', 'min-width: 160px', 'font-family: var(--font-mono)'],
    Badge: [
      'min-height: var(--badge-height)',
      'border: 1px solid',
      'border-radius: var(--radius-pill)',
      'font-size: var(--font-xs)',
    ],
    Tag: [
      'min-height: var(--badge-height)',
      'border: 0',
      'border-radius: var(--control-radius)',
      'font-family: var(--font-mono)',
    ],
    Chip: [
      'min-height: var(--chip-height)',
      'border-radius: var(--radius-pill)',
      'font-size: var(--font-sm)',
    ],
    Tabs: ['min-height: var(--tab-height)'],
    HelpMarker: ['width: var(--info-marker-size)', 'width: var(--help-tooltip-width)'],
    StatStrip: [
      'min-height: var(--stat-strip-min-height)',
      'align-items: flex-start',
      'font-family: var(--font-mono)',
    ],
    Text: ['font-size: var(--font-title)', 'font-size: var(--font-stat)', 'font-size: var(--font-xs)'].slice(
      0,
      2,
    ),
    Dialog: ['z-index: var(--z-dialog)', 'box-shadow: var(--shadow-dialog)'],
    Toast: ['z-index: var(--z-toast)'],
    Tooltip: ['z-index: var(--z-tooltip)'],
    Popover: ['z-index: var(--z-dropdown)', 'box-shadow: var(--shadow-popover)'],
    TextBlock: ['unicode-bidi: plaintext', 'text-align: start', 'white-space: pre-wrap'],
    ScoreValue: ['[data-band]', 'var(--tone-text)', "[data-variant='pill']", 'var(--metric-error)'],
    Card: [
      'var(--rail-width)',
      'background: var(--bg-surface)',
      'var(--border-subtle)',
      '[data-interactive]:hover',
      '[data-selected]',
      "[data-wash='danger']",
    ],
    Skeleton: ['prefers-reduced-motion'],
    FieldRow: ['var(--field-label-width)', 'var(--field-measure)', '@container'],
    StructuredValue: ['var(--border-subtle)', 'var(--font-mono)', 'prefers-reduced-motion'],
    SplitPane: ['cursor: col-resize', 'var(--accent-primary)', 'var(--border-subtle)'],
  };
  for (const [name, decls] of Object.entries(contracts)) {
    it(`${name}.module.css encodes its recipe`, () => {
      const css = ui(name);
      expect(
        css.trimStart().startsWith('/*'),
        `${name}.module.css must open with a comment naming its recipe`,
      ).toBe(true);
      for (const d of decls) expect(css, `${name}: '${d}'`).toContain(d);
    });
  }

  it('IconButton hover/focus/active change only the glyph colour', () => {
    const css = ui('IconButton');
    for (const state of ['[data-hovered]', '[data-active]', '[data-focus-visible]']) {
      const rule = css.split(`.iconAction${state} {`)[1]?.split('}')[0] ?? '';
      expect(rule, `${state} rule`).toContain('background: transparent;');
      expect(rule, `${state} rule`).toContain('box-shadow: none;');
      expect(rule).not.toContain('color-mix(');
    }
  });

  it('DataTable keeps the .qdt-table header/cell recipe', () => {
    const css = ui('DataTable');
    const th = css.match(/\.thead th \{([^}]*)\}/)?.[1] ?? '';
    expect(th).toContain('font-size: var(--font-sm)');
    expect(th).toContain('color: var(--text-muted)');
    expect(th).toContain('background: var(--bg-elevated)');
    expect(th).toContain('text-transform: uppercase');
    const td = css.match(/\.tbody td \{([^}]*)\}/)?.[1] ?? '';
    expect(td).toContain('font-size: var(--font-base)');
    expect(td).toContain('color: var(--text-secondary)');
    expect(td).toContain('font-family: var(--font-sans)');
  });

  it('DataTable v2 density, header and selection tokens are defined and used', () => {
    const tokens = read(join(SRC, 'styles/tokens.css'));
    for (const t of [
      '--row-compact: 32px',
      '--row-regular: 40px',
      '--row-comfortable: 52px',
      '--table-header-height: 34px',
      '--bg-selected:',
    ])
      expect(tokens, t).toContain(t);
    const css = ui('DataTable');
    for (const d of [
      'height: var(--table-header-height)',
      'height: var(--row-h)',
      'var(--bg-selected)',
      '--row-h: var(--row-compact)',
      'prefers-reduced-motion',
    ])
      expect(css, `DataTable: '${d}'`).toContain(d);
    expect(css).not.toMatch(/rgba\(0, 212, 170/);
  });

  it('raw <table> markup lives in ui/DataTable (the allow-list may only shrink)', () => {
    // Remaining raw tables, each with a reason. Compare/run-detail/report tables move in the second pass;
    // the rest are specialised matrices, prose, a dialog key list or tiny form tables.
    const ALLOWED = new Set([
      'features/analyzer/guidance/ExamplePicker.tsx', // selectable example list in a popover
      'features/compare/components/panel/CategoriesTab.tsx', // compare panels: second pass
      'features/compare/components/panel/MetricsTab.tsx',
      'features/compare/components/panel/RootCauseTab.tsx',
      'features/compare/components/panel/StepsTab.tsx',
      'features/compare/components/RunCards.tsx',
      'features/compare/components/sweep/SweepView.tsx',
      'features/datasets/wizard/UploadWizard.tsx', // preview grid of an uploaded file
      'features/docs/DocsArticle.tsx', // docs prose tables
      'features/experiments/detail/ChartCard.tsx', // chart legend table
      'features/experiments/detail/MatrixCard.tsx', // heatmap matrix
      'features/experiments/launch/settings/JsonFields.tsx', // key/value form rows
      'features/experiments/launch/settings/RoleTable.tsx', // role form table
      'features/runs-list/ShortcutsDialog.tsx', // key list in a dialog
      'sdk-viewer/components/RowList.tsx', // offline viewer, separate bundle
    ]);
    const found = tsxFiles
      .filter((f) => /<table[\s>]/.test(read(f)) && !rel(f).startsWith('ui/DataTable/'))
      .map(rel)
      .filter((f) => !f.includes('__tests__'));
    expect(
      found.filter((f) => !ALLOWED.has(f)),
      'Use DataTable (docs/DESIGN_LANGUAGE.md §3) instead of a raw <table>',
    ).toEqual([]);
    expect(
      [...ALLOWED].filter((f) => !found.includes(f)),
      'Remove migrated files from the allow-list',
    ).toEqual([]);
  });

  it('features compose primitives instead of restyling them', () => {
    const featureCss = cssFiles.filter((f) => rel(f).startsWith('features/'));
    const problems: string[] = [];
    for (const file of featureCss) {
      const text = read(file);
      if (/height:\s*var\(--control-height\)/.test(text))
        problems.push(`${rel(file)}: control height belongs to a primitive`);
      if (/--font-xs/.test(text)) problems.push(`${rel(file)}: --font-xs is badge chrome (use Badge/Tag)`);
      if (/--docs-(?:font|body)/.test(text) && !rel(file).startsWith('features/docs/'))
        problems.push(`${rel(file)}: --docs-* tokens are the docs prose exception (DESIGN_LANGUAGE §5)`);
      if (
        /border-radius:\s*var\(--radius-pill\)[^}]*cursor:\s*pointer|cursor:\s*pointer[^}]*border-radius:\s*var\(--radius-pill\)/s.test(
          text,
        )
      )
        problems.push(`${rel(file)}: pill buttons are Chip/Badge`);
    }
    expect(problems).toEqual([]);
  });

  it('TSX never hardcodes sizes or colours inline', () => {
    const problems: string[] = [];
    for (const file of tsxFiles) {
      const text = read(file);
      if (/style=\{\{[^}]*fontSize/.test(text)) problems.push(`${rel(file)}: inline fontSize`);
      if (/style=\{\{[^}]*(?:color|background):\s*['"]#/.test(text))
        problems.push(`${rel(file)}: inline hex colour`);
      if (/dangerouslySetInnerHTML/.test(text) && !rel(file).startsWith('ui/TextBlock/'))
        problems.push(`${rel(file)}: dangerouslySetInnerHTML outside TextBlock`);
    }
    expect(problems).toEqual([]);
  });
});

describe('visual language (redesign round 2)', () => {
  it('carries the tint, series, card and motion tokens verbatim', () => {
    const css = read(join(SRC, 'styles/tokens.css'));
    for (const decl of [
      '--tint-faint: 6%',
      '--tint-soft: 12%',
      '--tint-strong: 20%',
      '--error-text: color-mix(in srgb, var(--error) 75%, var(--text-primary))',
      '--chart-6: #a3e635',
      '--chart-7: #22d3ee',
      '--chart-8: #cbd5e1',
      '--rail-width: 3px',
      '--ease-out: cubic-bezier(0.16, 1, 0.3, 1)',
      '--motion-fill: 360ms',
      '--motion-stagger: 24ms',
      '--motion-flash: 700ms',
      '--dim-opacity: 0.45',
    ])
      expect(css, `tokens.css lost '${decl}'`).toContain(decl);
  });

  it('tones.css maps every tone, band and series to --tone/--tone-text', () => {
    const css = read(join(SRC, 'styles/tones.css'));
    for (const t of ['success', 'info', 'warning', 'danger', 'accent', 'meta', 'neutral'])
      expect(css, `tone ${t}`).toContain(`[data-tone='${t}']`);
    for (let b = 1; b <= 5; b += 1) expect(css, `band ${b}`).toContain(`[data-band='${b}']`);
    for (let n = 1; n <= 8; n += 1) expect(css, `series ${n}`).toContain(`[data-series='${n}']`);
    expect(read(join(SRC, 'main.tsx'))).toContain('./styles/tones.css');
    expect(read(join(SRC, 'sdk-viewer/main.tsx'))).toContain('tones.css');
  });

  it('has no raw rgba() colour literal outside tokens.css (tints are color-mix of --tone, scrims are tokens)', () => {
    const problems: string[] = [];
    for (const file of [...cssFiles, ...tsxFiles]) {
      if (rel(file) === 'styles/tokens.css') continue;
      const n = (read(file).match(/rgba?\(/g) ?? []).length;
      if (n) problems.push(`${rel(file)}: ${n}`);
    }
    expect(problems, 'Use color-mix(in srgb, var(--tone) var(--tint-soft), transparent) or a token').toEqual(
      [],
    );
  });

  it('lets no page declare its own .card (use ui/Card); the allow-list may only shrink', () => {
    // Remaining local card classes, each with a reason. Everything else composes <Card>.
    const ALLOWED = new Set<string>([
      // role=radio selection cards; Card's interactive mode is role=button + aria-pressed, which is not radio semantics.
      'features/experiments/launch/entry/entry.module.css',
      // Edge-to-edge tabs + wide data table inside an overflow:hidden card; Card's body padding would inset the table.
      'features/runs-list/ChartsPage.module.css',
    ]);
    const found = cssFiles
      .filter((f) => /^\.card(?![\w-])/m.test(read(f)))
      .map(rel)
      .filter((f) => !f.startsWith('ui/'));
    expect(
      found.filter((f) => !ALLOWED.has(f)),
      'Use Card (docs/DESIGN_LANGUAGE.md "Card") instead of a page-local .card',
    ).toEqual([]);
    expect(
      [...ALLOWED].filter((f) => !found.includes(f)),
      'Remove migrated files from the allow-list',
    ).toEqual([]);
  });

  it('gives sticky bars one of two heights: --bar-nav-h (report section bars) or --bar-action-h (action bars)', () => {
    const tokens = read(join(SRC, 'styles/tokens.css'));
    expect(tokens).toMatch(/--bar-nav-h:\s*44px/);
    expect(tokens).toMatch(/--bar-action-h:\s*56px/);
    const nav = [
      'features/run-detail/components/SectionNav.module.css',
      'features/compare/components/CompareBar.module.css',
    ];
    const action = [
      'features/experiments/launch/entry/entry.module.css',
      'features/analyzer/blocks/blocks.module.css',
      'features/run-detail/components/ItemsSection.module.css',
    ];
    for (const f of nav) expect(read(join(SRC, f)), `${f} uses --bar-nav-h`).toContain('var(--bar-nav-h)');
    for (const f of action)
      expect(read(join(SRC, f)), `${f} uses --bar-action-h`).toContain('var(--bar-action-h)');
    const legacy = cssFiles.filter((f) => /--compare-bar-h|--action-rail-height/.test(read(f)));
    expect(legacy.map(rel), 'retired per-page bar heights').toEqual([]);
  });

  it('keeps the hover underline for running text only (QG1-9, QG1-16)', () => {
    const base = read(join(SRC, 'styles/base.css'));
    expect(base).toContain("a:hover:where(:not([data-link='block']))");
    const hovers = [...base.matchAll(/(^|\n)([^{}\n]*a:hover[^{}]*)\{([^{}]*)\}/g)].filter((m) =>
      /text-decoration\s*:\s*underline/.test(m[3]!),
    );
    expect(hovers.map((m) => m[2]!.trim())).toEqual(["a:hover:where(:not([data-link='block']))"]);
    // :where keeps the rule at specificity (0,1,1): a component's own `.x:hover` override must still win
    expect(base).not.toMatch(/a:hover:not\(/);
    expect(read(join(SRC, 'ui/Card/Card.tsx'))).toContain('data-link="block"');
    expect(read(join(SRC, 'features/experiments/launch/entry/StartCard.tsx'))).toContain('data-link="block"');
    expect(read(join(SRC, 'features/docs/DocsPage.tsx'))).toContain('data-link="block"');
    expect(read(join(SRC, 'features/run-detail/components/RunHero.tsx'))).toContain('data-link="block"');
    // no stylesheet adds a hover underline for an anchor without the opt-out (the docs prose rule carries it)
    const loose = cssFiles.filter((f) =>
      [...read(f).matchAll(/([^{}]*a:hover[^{}]*)\{([^{}]*)\}/g)].some(
        (m) =>
          /text-decoration\s*:\s*underline/.test(m[2]!) &&
          !/data-link/.test(m[1]!) &&
          !/\.article\b|\.prose\b/.test(m[1]!),
      ),
    );
    expect(loose.map(rel).filter((f) => f !== 'src/styles/base.css')).toEqual([]);
  });

  it('LinkButton reaches the Button hover and press states from an anchor', () => {
    const css = read(join(SRC, 'ui/Button/Button.module.css'));
    expect(css).toContain('a.button:hover');
    expect(css).toContain('a.button:active');
    expect(css).toContain('a.button:focus-visible');
  });

  it('puts no transform, scale or glow on hover (colour, border and opacity only)', () => {
    const problems: string[] = [];
    for (const file of cssFiles) {
      for (const block of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const selector = block[1]!.trim();
        if (!/:hover|\[data-hovered\]/.test(selector)) continue;
        if (/\b(?:transform|translate|scale)\s*:/.test(block[2]!))
          problems.push(`${rel(file)}: '${selector.split('\n').pop()}' transforms on hover`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('never transitions scroll- or pin-driven geometry in ui/DataTable (perf round 6, A12)', () => {
    // Frozen cells and sticky headers follow the scroll position directly; a transition on `left`, `inset-*`,
    // `transform`, `box-shadow`, `width` or `all` would trail the scroll (the edge fade that used `opacity` is gone, round 7).
    const problems: string[] = [];
    // (cells/ holds the one-time data-mark entrance, not scroll-driven geometry)
    for (const file of cssFiles.filter(
      (f) => rel(f).startsWith('ui/DataTable/') && !rel(f).includes('/cells/'),
    )) {
      for (const block of read(file).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        for (const d of block[2]!.matchAll(
          /\b(transition(?:-property)?|animation(?:-name)?)\s*:\s*([^;]+);/g,
        )) {
          const value = d[2]!;
          if (/^\s*(none|0s)\b/.test(value)) continue;
          if (
            /\b(left|right|top|bottom|inset[\w-]*|transform|translate|box-shadow|width|inline-size|all)\b/.test(
              value,
            )
          )
            problems.push(`${rel(file)}: '${block[1]!.trim().split('\n').pop()}' ${d[1]}: ${value.trim()}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("draws a table's boundary with its own cells and paints nothing over scrolling content (round 7, Q1/D3)", () => {
    const css = read(join(SRC, 'ui/DataTable/DataTable.module.css'));
    // no overlay element, no scroll-cue fades, no gradient, no opacity transition on the table's chrome
    expect(css, 'a .edge overlay rule').not.toMatch(/\.edge\b/);
    expect(css, 'a [data-edge] rule').not.toContain('data-edge');
    // (the row tint layer and the skeleton shimmer are the only gradients; neither is a horizontal edge fade)
    expect(css, 'a horizontal edge fade').not.toMatch(/linear-gradient\(\s*to (?:left|right)/);
    expect(css, 'a pseudo-element fade on the body host').not.toMatch(/\.bodyHost[^{]*::(?:before|after)/);
    expect(css, 'will-change: opacity layers').not.toMatch(/will-change:\s*opacity/);
    // the pinned boundary: 1px --border-strong, inside the pinned cell's own box, on both sides and in RTL,
    // for the header, the group band and the body cells (row rails add the same line to their shadow)
    for (const side of ['start', 'end'] as const) {
      const line = side === 'start' ? 'inset -1px 0 0' : 'inset 1px 0 0';
      for (const cell of ['.th', '.td', '.bandCell']) {
        const block = css.match(
          new RegExp(
            `${cell.replace('.', '\\.')}\\[data-pin-edge='${side}'\\](?::dir\\(rtl\\))?,[^{]*\\{([^}]*)\\}`,
          ),
        );
        expect(block?.[1], `${cell}[data-pin-edge='${side}']`).toMatch(
          /--pin-line:\s*inset -?1px 0 0 var\(--border-strong\)/,
        );
        expect(css, `${cell} ${side} ${line}`).toContain(`--pin-line: ${line} var(--border-strong)`);
      }
    }
    expect(css).toMatch(
      /\.th\[data-pin-edge\],\s*\.td\[data-pin-edge\],\s*\.bandCell\[data-pin-edge\]\s*\{\s*box-shadow: var\(--pin-line\)/,
    );
    expect(css).toContain(':dir(rtl)');
    // the markup keeps the overlay out too
    expect(read(join(SRC, 'ui/DataTable/DataTable.tsx'))).not.toContain('styles.edge');
  });

  it('never truncates, clips or uppercases the name of a data key (round 7, D2)', () => {
    // [file, selector, uppercase allowed]: the eyebrow is the one fixed UI label that keeps the uppercase tracked style
    const keyRules: Array<[string, string, boolean]> = [
      ['ui/StructuredValue/KeyTree.module.css', '.key', false],
      ['ui/StructuredValue/StructuredValue.module.css', '.key', false],
      ['features/run-detail/components/items/MetricStrip.module.css', '.fact dt', false],
      ['features/run-detail/components/items/MetricStrip.module.css', '.eyebrow', true],
      ['ui/FieldRow/FieldRow.module.css', '.label', true],
    ];
    const problems: string[] = [];
    for (const [file, selector, upper] of keyRules) {
      const css = read(join(SRC, file));
      const escaped = selector.replace(/[.]/g, '\\.');
      const block = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1];
      if (block === undefined) {
        problems.push(`${file}: no ${selector} rule`);
        continue;
      }
      if (/text-overflow:\s*ellipsis/.test(block)) problems.push(`${file} ${selector}: ellipsis`);
      if (/white-space:\s*nowrap/.test(block)) problems.push(`${file} ${selector}: nowrap`);
      if (/max-inline-size:\s*[\d.]+ch/.test(block)) problems.push(`${file} ${selector}: a ch cap`);
      if (!upper && /text-transform:\s*uppercase/.test(block))
        problems.push(`${file} ${selector}: uppercase`);
      if (!/overflow-wrap:\s*anywhere/.test(block)) problems.push(`${file} ${selector}: does not wrap`);
    }
    expect(problems).toEqual([]);
  });

  it('animates data marks only through the shared motion tokens', () => {
    const cells = read(join(SRC, 'ui/DataTable/cells/cells.module.css'));
    expect(cells).toContain('var(--motion-fill)');
    expect(cells).toContain('var(--motion-stagger)');
    expect(read(join(SRC, 'styles/base.css'))).toContain('animation-delay: 0s !important');
  });
});

describe('documentation wiring', () => {
  it('README points at the design language', () => {
    const readme = read(join(FRONTEND, 'README.md'));
    expect(readme).toContain('docs/DESIGN_LANGUAGE.md');
    expect(readme).toContain('/__ui');
  });
});
