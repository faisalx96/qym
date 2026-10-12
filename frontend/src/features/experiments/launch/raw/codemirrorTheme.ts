/**
 * CodeMirror theme built from the app's CSS variables, so it follows the tokens (and any future
 * light palette) instead of carrying colours of its own. Lines choose their own direction
 * (`perLineTextDirection`) because documents mix Arabic and English text.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export function isDarkScheme(): boolean {
  if (typeof document === 'undefined') return true;
  const scheme = getComputedStyle(document.documentElement).colorScheme || '';
  return !scheme.includes('light') || scheme.includes('dark');
}

export function qymTheme(dark: boolean): Extension {
  const theme = EditorView.theme(
    {
      '&': {
        color: 'var(--text-primary)',
        backgroundColor: 'transparent',
        fontSize: 'var(--font-base)',
        maxHeight: '32rem',
      },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5', minHeight: '20rem' },
      '.cm-content': { caretColor: 'var(--text-primary)', padding: 'var(--space-sm) 0', unicodeBidi: 'plaintext' },
      '.cm-line': { padding: '0 var(--space-md)', unicodeBidi: 'plaintext' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--text-primary)' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: 'var(--bg-active)' },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-muted)',
        border: 'none',
        borderRight: '1px solid var(--border-subtle)',
      },
      '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
      '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--text-primary)' },
      '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--error)' },
      '.cm-lint-marker-error': { content: 'none' },
      '.cm-tooltip': {
        border: '1px solid var(--border-default)',
        backgroundColor: 'var(--bg-elevated)',
        color: 'var(--text-primary)',
        borderRadius: 'var(--control-radius)',
        fontSize: 'var(--font-sm)',
      },
      '.cm-diagnostic-error': { borderLeft: '3px solid var(--error)' },
      '.cm-panels': { backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' },
    },
    { dark },
  );
  const highlight = HighlightStyle.define([
    { tag: t.propertyName, color: 'var(--text-primary)' },
    { tag: t.string, color: 'var(--accent-primary)' },
    { tag: t.number, color: 'var(--info)' },
    { tag: [t.bool, t.null], color: 'var(--warning)' },
    { tag: [t.punctuation, t.separator, t.brace, t.squareBracket], color: 'var(--text-muted)' },
  ]);
  return [theme, syntaxHighlighting(highlight)];
}
