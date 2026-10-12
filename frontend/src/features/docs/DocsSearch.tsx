import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Kbd, SearchField } from '@/ui';
import { docsPath, loadSearchIndex, searchDocs, type SearchRecord } from './content';
import styles from './DocsSearch.module.css';

/**
 * Full-text docs search as an ARIA combobox: input + listbox popover with
 * crumb ("Section › Page"), heading hits and excerpts. `/` focuses from
 * anywhere (unless typing), Arrow keys move, Enter opens, Escape clears.
 */
export function DocsSearch() {
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<SearchRecord[] | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = document.activeElement as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      input.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (query && !records) void loadSearchIndex().then(setRecords);
  }, [query, records]);

  const hits = useMemo(() => (records ? searchDocs(records, query) : []), [records, query]);
  const show = open && query.trim().length > 0;
  const idx = Math.min(active, Math.max(0, hits.length - 1));

  function go(i: number) {
    const hit = hits[i];
    if (!hit) return;
    navigate(docsPath(hit.ref, hit.heading?.id));
    setQuery('');
    setOpen(false);
    input.current?.blur();
  }

  return (
    <div className={styles.wrap} data-docs-search>
      <SearchField
        ref={input}
        label="Search docs"
        hideLabel
        placeholder="Search docs…"
        hint="/"
        value={query}
        onChange={(v) => {
          setQuery(v);
          setActive(0);
          setOpen(true);
        }}
        onClear={() => setQuery('')}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(hits.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            go(idx);
          } else if (e.key === 'Escape') {
            if (query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            } else input.current?.blur();
          }
        }}
        inputProps={{
          role: 'combobox',
          'aria-expanded': show,
          'aria-controls': listId,
          'aria-autocomplete': 'list',
          'aria-activedescendant': show && hits.length ? `${listId}-${idx}` : undefined,
        }}
      />
      {show ? (
        <ul id={listId} role="listbox" aria-label="Search results" className={styles.list}>
          {!records ? (
            <li className={styles.empty}>Searching…</li>
          ) : hits.length === 0 ? (
            <li className={styles.empty} role="option" aria-selected={false}>
              No results for “{query}”
            </li>
          ) : (
            hits.map((h, i) => (
              <li
                key={`${h.ref.key}#${h.heading?.id ?? ''}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === idx}
                data-active={i === idx || undefined}
                className={styles.option}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(i);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={styles.crumb}>
                  {h.ref.sectionTitle} › {h.ref.title}
                </span>
                <span className={styles.title}>{h.heading ? h.heading.text : h.ref.title}</span>
                {h.excerpt ? <span className={styles.excerpt}>{h.excerpt}</span> : null}
              </li>
            ))
          )}
          <li className={styles.foot} aria-hidden="true">
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move <Kbd>↵</Kbd> open <Kbd>Esc</Kbd> clear
          </li>
        </ul>
      ) : null}
    </div>
  );
}
