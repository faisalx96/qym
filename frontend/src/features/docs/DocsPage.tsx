import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { EmptyState, ErrorState, Icon, LinkButton, Skeleton, Text, type IconName } from '@/ui';
import { useDelayedPending } from '@/lib/pending';
import { SECTIONS, docsPath, type DocsHeading } from './content';
import { DocsArticle, scrollToHeading } from './DocsArticle';
import { DocsSearch } from './DocsSearch';
import { useDocsPage } from './useDocsPage';
import { useScrollSpy } from './useScrollSpy';
import styles from './DocsPage.module.css';

const SECTION_ICON: Record<string, IconName> = {
  rocket: 'sparkles',
  grid: 'grid',
  code: 'review',
  terminal: 'flask',
};

function Toc({ headings, active }: { headings: DocsHeading[]; active: string | null }) {
  const { pathname } = useLocation();
  if (!headings.length) return null;
  return (
    <nav aria-label="On this page" className={styles.toc} data-docs-toc>
      <p className={styles.tocTitle}>On this page</p>
      <ul>
        {headings.map((h) => (
          <li key={h.id}>
            <Link
              to={{ pathname, hash: h.id }}
              replace
              data-level={h.level}
              aria-current={active === h.id ? 'location' : undefined}
              onClick={(e) => {
                if (scrollToHeading(h.id, true)) {
                  e.preventDefault();
                  history.replaceState(
                    history.state,
                    '',
                    `${window.location.pathname}${window.location.search}#${h.id}`,
                  );
                }
              }}
            >
              {h.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** /docs/:section/:page — nav · article · TOC (hybrid layout), search popover with `/`. */
export function DocsPage() {
  const state = useDocsPage();
  const { ref, payload, prev, next } = state;
  const active = useScrollSpy(state.headingIds, payload !== undefined && payload !== null);
  const skeleton = useDelayedPending(payload === undefined);
  const [navOpen, setNavOpen] = useState(false);
  const h1 = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const first = useRef(true);

  // New page: move focus to the article (screen readers announce the new h1), unless a deep-link heading was asked.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!window.location.hash) h1.current?.focus({ preventScroll: true });
  }, [ref.key]);
  // Keep the current page visible in the sticky nav rail.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  }, [ref.key]);

  const headings: DocsHeading[] = payload ? payload.headings : [];

  return (
    <div className={styles.page} data-docs-page>
      <aside className={styles.nav}>
        <button
          type="button"
          className={styles.navToggle}
          aria-expanded={navOpen}
          aria-controls="docs-nav"
          onClick={() => setNavOpen((o) => !o)}
        >
          <Icon name="menu" size={14} /> Browse docs
        </button>
        <nav
          id="docs-nav"
          ref={navRef}
          aria-label="Documentation"
          className={styles.navBody}
          data-open={navOpen || undefined}
        >
          <DocsSearch />
          {SECTIONS.map((s) => (
            <section key={s.id} className={styles.section}>
              <h2 className={styles.sectionTitle}>
                <Icon name={SECTION_ICON[s.icon] ?? 'book'} size={14} /> {s.title}
              </h2>
              <ul>
                {s.pages.map((p) => (
                  <li key={p.id}>
                    <Link
                      to={docsPath({ section: s.id, page: p.id })}
                      aria-current={s.id === ref.section && p.id === ref.page ? 'page' : undefined}
                      onClick={() => setNavOpen(false)}
                    >
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </aside>
      <div className={styles.main} aria-busy={payload === undefined || undefined}>
        <div ref={h1} tabIndex={-1} className={styles.focusTarget}>
          {payload === undefined ? (
            skeleton ? (
              <Skeleton kind="lines" rows={8} label={`Loading ${ref.title}`} />
            ) : null
          ) : payload === null && state.error ? (
            <ErrorState
              error={state.error}
              title={`Couldn’t load ${ref.title}`}
              onRetry={() => window.location.reload()}
              compact
            />
          ) : payload === null ? (
            <article>
              <p className={styles.notWrittenEyebrow}>{ref.sectionTitle}</p>
              <EmptyState
                icon={<Icon name="warning" />}
                title={ref.title}
                body="This page hasn’t been written yet."
              />
            </article>
          ) : (
            <>
              <details className={styles.tocNarrow}>
                <summary>On this page</summary>
                <Toc headings={headings} active={active} />
              </details>
              <DocsArticle
                hast={payload.hast}
                footer={
                  <nav aria-label="Previous and next page" className={styles.pager}>
                    {prev ? (
                      <LinkButton to={docsPath(prev)} variant="neutral" size="md" className={styles.prev}>
                        <span className={styles.pagerLabel}>Previous</span>
                        <span>{prev.title}</span>
                      </LinkButton>
                    ) : (
                      <span />
                    )}
                    {next ? (
                      <LinkButton to={docsPath(next)} variant="neutral" size="md" className={styles.next}>
                        <span className={styles.pagerLabel}>Next</span>
                        <span>{next.title}</span>
                      </LinkButton>
                    ) : null}
                  </nav>
                }
              />
            </>
          )}
        </div>
        <Text variant="sm" tone="muted" className={styles.hint} aria-hidden="true">
          Press / to search
        </Text>
      </div>
      <div className={styles.tocRail}>
        <Toc headings={headings} active={active} />
      </div>
    </div>
  );
}
