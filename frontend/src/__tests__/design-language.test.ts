/**
 * Port of tests/platform/test_design_language.py for frontend/ (brief 02 §8.2).
 * Enforces docs/DESIGN_LANGUAGE.md over src/**: tokens-only typography, the
 * text-colour ramp, mono-for-data, themed surfaces, and the primitive
 * module contracts. Read the doc before "fixing" a rule here.
 */
import { readFileSync } from 'node:fs';
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
      'features/run-detail/components/panels/RepeatTab.tsx', // run-detail: second pass
      'features/runs-list/PassesPanel.tsx', // nested passes list with its own select/delete controls
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
      '--chart-6: #60a5fa',
      '--chart-7: #34d399',
      '--chart-8: #fb923c',
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
    const ALLOWED = new Set<string>([]);
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
