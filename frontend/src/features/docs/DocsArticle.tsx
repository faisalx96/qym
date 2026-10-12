/**
 * Renders a compiled docs page (hast JSON from frontend/plugins/docs-content.ts)
 * as React elements: no HTML strings. Content classes (docs-callout, docs-cards,
 * docs-lead, docs-eyebrow) are styled under .article in DocsArticle.module.css.
 */
import { Fragment, useMemo, useRef, type ComponentProps, type ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { Link } from 'react-router-dom';
import { toJsxRuntime, type Components } from 'hast-util-to-jsx-runtime';
import type { Root } from 'hast';
import { CopyButton, Icon, useToast } from '@/ui';
import { legacyHashToPath } from './content';
import styles from './DocsArticle.module.css';

type PreProps = ComponentProps<'pre'> & {
  'data-lang'?: string;
  'data-highlighted'?: string;
  'data-wrap'?: string;
};

function CodeBlock({
  'data-lang': lang = 'code',
  'data-highlighted': highlighted,
  'data-wrap': wrap,
  children,
}: PreProps) {
  const pre = useRef<HTMLPreElement>(null);
  const toast = useToast();
  return (
    <div className={styles.codeblock} data-docs-codeblock>
      <div className={styles.codeHead}>
        <span className={styles.codeLang}>{lang}</span>
        <CopyButton
          text={() => pre.current?.textContent ?? ''}
          label="Copy code"
          onCopied={() => toast.show('Copied to clipboard', { tone: 'success' })}
        />
      </div>
      {/* scrollable code must be keyboard-focusable */}
      <pre
        ref={pre}
        data-lang={lang}
        data-highlighted={highlighted}
        data-wrap={wrap}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        aria-label={`${lang} code`}
      >
        {children}
      </pre>
    </div>
  );
}

function DocsLink({ href, children, ...rest }: ComponentProps<'a'>) {
  if (href && href.startsWith('#')) {
    const path = legacyHashToPath(href);
    if (path) {
      return (
        <Link to={path} {...rest}>
          {children}
        </Link>
      );
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  const external = Boolean(href && /^https?:/i.test(href));
  return (
    <a href={href} {...rest} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}>
      {children}
      {external ? <Icon name="external" size={12} className={styles.externalGlyph} /> : null}
    </a>
  );
}

function DocsTable(props: ComponentProps<'table'>) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Table">
      <table {...props} />
    </div>
  );
}

function heading(level: 2 | 3) {
  const Tag = level === 2 ? 'h2' : 'h3';
  return function DocsHeading({ id, children, ...rest }: ComponentProps<'h2'>) {
    const text = typeof children === 'string' ? children : '';
    return (
      <Tag id={id} {...rest} className={styles.heading}>
        {children}
        {id ? (
          <Link
            to={{ hash: id }}
            replace
            className={styles.anchor}
            aria-label={text ? `Link to “${text}”` : 'Link to this section'}
          >
            <span aria-hidden="true">#</span>
          </Link>
        ) : null}
      </Tag>
    );
  };
}

const COMPONENTS: Partial<Components> = {
  pre: CodeBlock as Components['pre'],
  a: DocsLink as Components['a'],
  table: DocsTable as Components['table'],
  h2: heading(2) as Components['h2'],
  h3: heading(3) as Components['h3'],
};

export interface DocsArticleProps {
  hast: Root;
  /** Appended after the content (pager). */
  footer?: ReactNode;
  className?: string;
}

export function DocsArticle({ hast, footer, className }: DocsArticleProps) {
  const body = useMemo(
    () => toJsxRuntime(hast, { Fragment, jsx, jsxs, components: COMPONENTS, ignoreInvalidStyle: true }),
    [hast],
  );
  return (
    <article className={[styles.article, className].filter(Boolean).join(' ')} data-docs-article>
      {body}
      {footer}
    </article>
  );
}

/** Scroll a heading into view inside the shell scroller (no window scrolling). */
export function scrollToHeading(id: string, smooth = true): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  return true;
}
