/**
 * Build-time docs content (area 09, decision in
 * docs/internal/ui-migration/decisions/admin-docs/OPEN_QUESTIONS.md).
 *
 * The 27 hand-written HTML partials under
 * packages/platform/qym_platform/_static/dashboard/docs/<section>/<page>.html
 * stay the single content source. This plugin compiles each one at build
 * time into a hast tree (JSON) that the React side renders through
 * hast-util-to-jsx-runtime — no runtime innerHTML, no runtime highlighter:
 *
 *   - headings get stable slug ids (same algorithm as the vanilla docs.js),
 *   - <pre data-lang> blocks are highlighted by Shiki with a theme whose
 *     colours are the --code-* tokens (emitted as classes, not inline styles),
 *   - script/style/event-handler attributes are stripped defensively,
 *   - a per-page search record (title, headings, plain text) is produced.
 *
 * Virtual modules:
 *   virtual:qym-docs/pages            { loaders: { 'section/page': () => import(...) } }
 *   virtual:qym-docs/page/<s>/<p>     default: { hast, headings }
 *   virtual:qym-docs/search           default: SearchRecord[]
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { fromHtml } from 'hast-util-from-html';
import { toText } from 'hast-util-to-text';
import { visit, SKIP } from 'unist-util-visit';
import { createHighlighter, type Highlighter, type ThemeRegistration } from 'shiki';
import type { Element, Root, RootContent } from 'hast';

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(here, '..');
export const DOCS_CONTENT_DIR = resolve(FRONTEND, '../packages/platform/qym_platform/_static/dashboard/docs');
export const DOCS_IA_FILE = resolve(FRONTEND, 'src/features/docs/ia.json');

const PREFIX = 'virtual:qym-docs/';
const RESOLVED = '\0' + PREFIX;

interface IaPage {
  id: string;
  title: string;
}
interface IaSection {
  id: string;
  title: string;
  icon: string;
  pages: IaPage[];
}
interface Ia {
  sections: IaSection[];
}

export interface DocsHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface SearchRecord {
  key: string;
  section: string;
  sectionTitle: string;
  title: string;
  headings: DocsHeading[];
  text: string;
}

function readIa(): Ia {
  return JSON.parse(readFileSync(DOCS_IA_FILE, 'utf-8')) as Ia;
}

export function partialPath(section: string, page: string): string {
  return resolve(DOCS_CONTENT_DIR, section, `${page}.html`);
}

/** Same slug algorithm as the vanilla docs.js so old `#section/page/heading` links keep resolving. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** data-lang values (or filenames) → Shiki language ids. */
export function shikiLang(label: string): 'python' | 'bash' | 'json' | 'yaml' | 'javascript' | null {
  const l = String(label || '').toLowerCase();
  if (l === 'python' || /\.py$/.test(l)) return 'python';
  if (l === 'bash' || l === 'shell' || l === 'sh' || /\.(sh|bash)$/.test(l)) return 'bash';
  if (l === 'json' || /\.json$/.test(l)) return 'json';
  if (l === 'yaml' || l === 'yml' || /\.ya?ml$/.test(l)) return 'yaml';
  if (l === 'javascript' || l === 'js' || /\.js$/.test(l)) return 'javascript';
  return null;
}

/** TextMate scopes → the --code-* tokens (DESIGN_LANGUAGE: syntax palette stays tokenised). */
const THEME: ThemeRegistration = {
  name: 'qym-tokens',
  type: 'dark',
  colors: { 'editor.background': 'var(--bg-surface)', 'editor.foreground': 'var(--text-primary)' },
  settings: [
    { settings: { foreground: 'var(--text-primary)', background: 'var(--bg-surface)' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--code-comment)', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage', 'storage.type', 'storage.modifier', 'keyword.operator.logical.python'], settings: { foreground: 'var(--code-keyword)' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: 'var(--code-string)' } },
    { scope: ['constant.numeric', 'constant.language', 'constant.character.escape'], settings: { foreground: 'var(--code-number)' } },
    { scope: ['support.function', 'entity.name.function', 'meta.function-call.generic', 'support.function.builtin'], settings: { foreground: 'var(--code-builtin)' } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class', 'entity.other.inherited-class'], settings: { foreground: 'var(--code-class)' } },
    { scope: ['support.type.property-name.json', 'entity.name.tag.yaml'], settings: { foreground: 'var(--code-number)' } },
    { scope: ['variable.parameter', 'meta.function.parameters'], settings: { foreground: 'var(--text-secondary)' } },
  ],
};

const TOKEN_CLASS: Record<string, string> = {
  'var(--code-comment)': 'tok-comment',
  'var(--code-keyword)': 'tok-keyword',
  'var(--code-string)': 'tok-string',
  'var(--code-number)': 'tok-number',
  'var(--code-builtin)': 'tok-builtin',
  'var(--code-class)': 'tok-class',
  'var(--text-secondary)': 'tok-muted',
};

let highlighterPromise: Promise<Highlighter> | null = null;
function highlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: [THEME], langs: ['python', 'bash', 'json', 'yaml', 'javascript'] });
  return highlighterPromise;
}

function stripPositions(tree: Root): void {
  visit(tree, (node) => {
    delete (node as { position?: unknown }).position;
  });
}

const DROPPED_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta']);

/** Defensive: the content is repo-owned, but never ship active content. */
function sanitize(tree: Root): void {
  visit(tree, 'element', (node: Element, index, parent) => {
    if (DROPPED_TAGS.has(node.tagName) && parent && typeof index === 'number') {
      parent.children.splice(index, 1);
      return index;
    }
    for (const key of Object.keys(node.properties)) {
      if (/^on/i.test(key)) delete node.properties[key];
    }
    const href = node.properties.href;
    if (typeof href === 'string' && /^\s*javascript:/i.test(href)) delete node.properties.href;
    return undefined;
  });
}

/** Shiki emits inline `style="color:var(--code-x)"`; swap for a class and drop the pre wrapper. */
function tokenClasses(code: Element): Element {
  visit(code, 'element', (span: Element) => {
    const style = span.properties.style;
    if (typeof style !== 'string') return;
    const colour = /color:(var\(--[\w-]+\))/.exec(style)?.[1];
    const italic = /font-style:italic/.test(style);
    delete span.properties.style;
    const classes: string[] = [];
    const cls = colour ? TOKEN_CLASS[colour] : undefined;
    if (cls) classes.push(cls);
    if (italic) classes.push('tok-italic');
    if (classes.length) span.properties.className = classes;
  });
  delete code.properties.style;
  return code;
}

export interface CompiledPage {
  hast: Root;
  headings: DocsHeading[];
  text: string;
}

/** Compile one partial: ids on h2/h3, Shiki on <pre data-lang>, sanitize, plain text. */
export async function compilePartial(html: string): Promise<CompiledPage> {
  const tree = fromHtml(html, { fragment: true });
  sanitize(tree);
  const headings: DocsHeading[] = [];
  const seen = new Map<string, number>();
  visit(tree, 'element', (node: Element) => {
    if (node.tagName !== 'h2' && node.tagName !== 'h3') return;
    const text = toText(node).trim();
    let id = typeof node.properties.id === 'string' && node.properties.id ? node.properties.id : slugify(text);
    if (!id) id = `section-${headings.length}`;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n) id = `${id}-${n + 1}`;
    node.properties.id = id;
    headings.push({ id, text, level: node.tagName === 'h3' ? 3 : 2 });
  });
  const pres: Element[] = [];
  visit(tree, 'element', (node: Element) => {
    if (node.tagName === 'pre') {
      pres.push(node);
      return SKIP;
    }
    return undefined;
  });
  const hl = pres.length ? await highlighter() : null;
  for (const pre of pres) {
    const label = String(pre.properties.dataLang ?? 'code');
    const source = toText(pre).replace(/\n$/, '');
    const lang = shikiLang(label);
    pre.properties.dataLang = label;
    if (lang && hl) {
      const out = hl.codeToHast(source, { lang, theme: 'qym-tokens' });
      const shikiPre = out.children.find((c): c is Element => c.type === 'element' && c.tagName === 'pre');
      const code = shikiPre?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
      if (code) {
        pre.children = [tokenClasses(code)];
        pre.properties.dataHighlighted = 'true';
      }
    } else {
      pre.children = [{ type: 'text', value: source }];
      if (!source.includes('\n')) pre.properties.dataWrap = 'true';
    }
  }
  stripPositions(tree);
  const text = toText(tree).replace(/\s+/g, ' ').trim();
  return { hast: tree, headings, text };
}

export function docsContentPlugin(): Plugin {
  return {
    name: 'qym-docs-content',
    resolveId(id) {
      if (id.startsWith(PREFIX)) return '\0' + id;
      return null;
    },
    async load(id) {
      if (!id.startsWith(RESOLVED)) return null;
      const rest = id.slice(RESOLVED.length);
      const ia = readIa();
      this.addWatchFile(DOCS_IA_FILE);
      if (rest === 'pages') {
        const entries = ia.sections.flatMap((s) =>
          s.pages.map((p) => `  ${JSON.stringify(`${s.id}/${p.id}`)}: () => import(${JSON.stringify(`${PREFIX}page/${s.id}/${p.id}`)}),`),
        );
        return `export const loaders = {\n${entries.join('\n')}\n};\n`;
      }
      if (rest === 'search') {
        const records: SearchRecord[] = [];
        for (const s of ia.sections) {
          for (const p of s.pages) {
            const file = partialPath(s.id, p.id);
            this.addWatchFile(file);
            if (!existsSync(file)) continue;
            const compiled = await compilePartial(readFileSync(file, 'utf-8'));
            records.push({
              key: `${s.id}/${p.id}`,
              section: s.id,
              sectionTitle: s.title,
              title: p.title,
              headings: compiled.headings,
              text: compiled.text.slice(0, 24_000),
            });
          }
        }
        return `export default ${JSON.stringify(records)};\n`;
      }
      if (rest.startsWith('page/')) {
        const [section, page] = rest.slice('page/'.length).split('/');
        const known = ia.sections.some((s) => s.id === section && s.pages.some((p) => p.id === page));
        if (!section || !page || !known) return `export default null;\n`;
        const file = partialPath(section, page);
        this.addWatchFile(file);
        if (!existsSync(file)) return `export default null;\n`;
        const compiled = await compilePartial(readFileSync(file, 'utf-8'));
        return `export default ${JSON.stringify({ hast: compiled.hast, headings: compiled.headings })};\n`;
      }
      return null;
    },
  };
}

export type { Root as HastRoot, RootContent as HastContent };
