import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from 'react';
import { Icon, JsonText } from '@/ui';
import { textDirAttrs } from '@/lib/text';
import {
  hasMark,
  lineSpan,
  type Block,
  type Line,
  type ListItem,
  type PromptDoc,
  type Section,
} from '../model/promptDoc';
import { stateText, type NotePlace } from '../model/outline';
import s from './promptDoc.module.css';

/** A part of the item data or a document longer than this many lines starts closed (a change or a jump opens it). */
const CLOSED_FROM = 80;

interface DocState {
  /** Line indexes the last settings change added (change marks). */
  added: ReadonlySet<number> | undefined;
  /** Identity of the last change: a new change opens the sections that hold its lines. */
  change: object | null;
  /** A jump from the outline: the ids to open, with a counter so the same jump twice works. */
  jump: { ids: ReadonlySet<string>; n: number } | null;
  /** DOM id prefix of this message's sections. */
  prefix: string;
  /** cv5 Q4: section keys to mark (the Prompt contents switch under the pointer or the focus). */
  peek: ReadonlySet<string> | null;
  /** cv5 N: the note lines of the sections that are not in the prompt, by container ('' = the top level). */
  notes: ReadonlyMap<string, NotePlace[]>;
}

const NO_NOTES: ReadonlyMap<string, NotePlace[]> = new Map();

const Ctx = createContext<DocState>({
  added: undefined,
  change: null,
  jump: null,
  prefix: '',
  peek: null,
  notes: NO_NOTES,
});

const leading = (text: string) => text.length - text.trimStart().length;
/** The line without its layout indent (the leading spaces that the structure already shows). */
const shown = (line: Line, indent: number) => line.text.slice(Math.min(indent, leading(line.text)));

function Ln({ line, indent = 0, children }: { line: Line; indent?: number; children?: ReactNode }) {
  const { added } = useContext(Ctx);
  return (
    <span className={s.ln} data-added={added?.has(line.i) ? '' : undefined}>
      {children ?? shown(line, indent)}
    </span>
  );
}

/** The heading text with its trailing colon (kept, quiet). */
function Title({ section }: { section: Section }) {
  if (section.role === 'document') {
    const name = section.head.text.replace(/^DOCUMENT:\s?/, '');
    return (
      <>
        <span className={s.tail}>{section.head.text.slice(0, section.head.text.length - name.length)}</span>
        <span className={s.docName}>{name}</span>
      </>
    );
  }
  if (section.role === 'step') {
    const m = /^(Step \d+ —\s?)(.*)$/.exec(section.title);
    return (
      <>
        {m ? (
          <>
            <span className={s.stepNo}>{m[1]}</span>
            <span className={s.stepName}>{m[2]}</span>
          </>
        ) : (
          section.title
        )}
        <span className={s.tail}>{section.tail}</span>
      </>
    );
  }
  return (
    <>
      {section.title.trimStart()}
      <span className={s.tail}>{section.tail}</span>
    </>
  );
}

function Collapsible({ section, level }: { section: Section; level: 1 | 2 }) {
  const ctx = useContext(Ctx);
  const span = lineSpan(section);
  const long = level === 2 && span.count > CLOSED_FROM;
  const [open, setOpen] = useState(!long);
  const [seen, setSeen] = useState<{ change: object | null; jump: DocState['jump'] }>({
    change: ctx.change,
    jump: ctx.jump,
  });
  // A new change opens a section that holds an added line; a jump opens the sections on its path.
  if (seen.change !== ctx.change || seen.jump !== ctx.jump) {
    setSeen({ change: ctx.change, jump: ctx.jump });
    if (
      (seen.change !== ctx.change && hasMark(section, ctx.added)) ||
      (seen.jump !== ctx.jump && ctx.jump?.ids.has(section.id))
    )
      setOpen(true);
  }
  const Heading = level === 1 ? 'h3' : 'h4';
  const bodyId = `${ctx.prefix}${section.id}-body`;
  return (
    <section
      id={`${ctx.prefix}${section.id}`}
      className={s.section}
      data-level={level}
      data-role={section.role}
      data-key={section.key ?? undefined}
      data-peek={section.key && ctx.peek?.has(section.key) ? '' : undefined}
    >
      <Heading className={s.heading}>
        <button
          type="button"
          className={s.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chevron-right" size={12} className={s.chevron} aria-hidden="true" />
          <span className={s.titleText} data-added={ctx.added?.has(section.head.i) ? '' : undefined}>
            <Title section={section} />
          </span>
          {open ? null : (
            <span className={s.count}>{`${span.count} ${span.count === 1 ? 'line' : 'lines'}`}</span>
          )}
        </button>
      </Heading>
      {/* closed content stays in the page (the rendered view holds every character of the prompt) */}
      <div id={bodyId} className={s.body} hidden={!open}>
        <Blocks blocks={section.children} container={section.id} />
      </div>
    </section>
  );
}

function SectionBlock({ section }: { section: Section }) {
  const ctx = useContext(Ctx);
  switch (section.role) {
    case 'section':
      return <Collapsible section={section} level={1} />;
    case 'field':
    case 'document':
      return <Collapsible section={section} level={2} />;
    case 'traceGroup':
      return (
        <div id={`${ctx.prefix}${section.id}`} className={s.traceGroup}>
          <p className={s.traceGroupHead}>
            <Ln line={section.head}>
              <Title section={section} />
            </Ln>
          </p>
          <Blocks blocks={section.children} />
        </div>
      );
    case 'step':
      return (
        <div className={s.step}>
          <p className={s.stepHead}>
            <Ln line={section.head}>
              <Title section={section} />
            </Ln>
          </p>
          <div className={s.stepBody}>
            <Blocks blocks={section.children} />
          </div>
        </div>
      );
    case 'part':
      return (
        <div className={s.part}>
          <p className={s.partHead}>
            <Ln line={section.head}>
              <Title section={section} />
            </Ln>
          </p>
          <Blocks blocks={section.children} />
        </div>
      );
  }
}

function ListBlock({ items }: { items: ListItem[] }) {
  return (
    <ul className={s.list}>
      {items.map((item) => (
        <li key={item.head.i} className={s.item}>
          <span className={s.marker}>{item.marker}</span>
          <div className={s.itemBody}>
            <Ln line={item.head}>
              <span className={item.children.length ? s.itemHead : undefined}>{item.text}</span>
            </Ln>
            {item.children.length ? <Blocks blocks={item.children} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function BlockView({ block }: { block: Block }) {
  const { added } = useContext(Ctx);
  switch (block.kind) {
    case 'blank':
      return null;
    case 'para':
      return (
        <p className={s.para} {...textDirAttrs(block.lines.map((l) => l.text).join('\n'))}>
          {block.lines.map((l) => (
            <Ln key={l.i} line={l} indent={block.indent} />
          ))}
        </p>
      );
    case 'text':
      return (
        <div className={s.text} {...textDirAttrs(block.lines.map((l) => l.text).join('\n'))}>
          {block.lines.map((l) => (
            <Ln key={l.i} line={l} indent={block.indent} />
          ))}
        </div>
      );
    case 'code':
      return (
        <pre className={s.code} dir="ltr" data-json={block.json ? '' : undefined}>
          {block.lines.map((l) => (
            <Ln key={l.i} line={l}>
              {block.json ? <JsonText text={shown(l, block.indent)} /> : shown(l, block.indent)}
            </Ln>
          ))}
        </pre>
      );
    case 'term':
      return (
        <div className={s.termBlock}>
          <p className={s.term}>
            <Ln line={block.line}>
              {block.marker ? <span className={s.termNo}>{block.marker}</span> : null}
              <code className={s.termName}>{block.term}</code>
              <span className={s.tail}> - </span>
              {block.rest}
            </Ln>
          </p>
          {block.children.length ? (
            <div className={s.termChoices}>
              <Blocks blocks={block.children} />
            </div>
          ) : null}
        </div>
      );
    case 'numbered':
      return (
        <div className={s.numbered}>
          <span className={s.marker}>{block.marker}</span>
          <div className={s.itemBody}>
            <Ln line={block.head}>
              <span className={s.itemHead}>{block.title}</span>
            </Ln>
            {block.body.length ? (
              <p className={s.para} {...textDirAttrs(block.body.map((l) => l.text).join('\n'))}>
                {block.body.map((l) => (
                  <Ln key={l.i} line={l} indent={block.indent} />
                ))}
              </p>
            ) : null}
          </div>
        </div>
      );
    case 'list':
      return <ListBlock items={block.items} />;
    case 'group':
      return (
        <div className={s.group}>
          <p className={s.groupHead}>
            <Ln line={block.head}>
              {block.label}
              <span className={s.tail}>:</span>
            </Ln>
          </p>
          <Blocks blocks={block.children} />
        </div>
      );
    case 'facts':
      return (
        <dl className={s.facts}>
          {block.rows.map((r) => (
            <div key={r.line.i} className={s.fact} data-added={added?.has(r.line.i) ? '' : undefined}>
              <dt>{`${r.key}:`}</dt>
              <dd {...textDirAttrs(r.value)}>{r.value}</dd>
            </div>
          ))}
        </dl>
      );
    case 'mdHeading': {
      const m = /^(#{1,6}\s+)(.*)$/.exec(block.line.text);
      return (
        <p className={s.mdHeading} {...textDirAttrs(m?.[2] ?? block.line.text)}>
          <Ln line={block.line}>
            <span className={s.tail}>{m?.[1] ?? ''}</span>
            {m?.[2] ?? block.line.text}
          </Ln>
        </p>
      );
    }
    case 'rule':
      return (
        <p className={s.rule}>
          <Ln line={block.line} />
        </p>
      );
    case 'section':
      return <SectionBlock section={block} />;
  }
}

/**
 * cv5 N: a section that is not in the prompt keeps its place: one quiet line, "Reference documents: not sent". It is
 * interface text, not prompt text: no id of the raw text, not selectable, never part of Copy or of the raw view.
 */
function NoteLine({ place }: { place: NotePlace }) {
  const { prefix, peek } = useContext(Ctx);
  const { row } = place;
  return (
    <p
      id={`${prefix}${row.id}`}
      className={s.noteLine}
      data-depth={row.depth}
      data-key={row.key ?? undefined}
      data-peek={row.key && peek?.has(row.key) ? '' : undefined}
      data-ui-note=""
    >
      <span className={s.noteName}>{row.label}</span>
      {`: ${row.state === 'empty' ? 'none for this target' : stateText(row.state)}`}
    </p>
  );
}

/** The blocks of one container; `container` (a section id, '' for the top level) places its note lines. */
function Blocks({ blocks, container }: { blocks: Block[]; container?: string }) {
  const { notes } = useContext(Ctx);
  const here = container === undefined ? undefined : notes.get(container);
  if (!here?.length)
    return (
      <>
        {blocks.map((block, n) => (
          <BlockView key={n} block={block} />
        ))}
      </>
    );
  const before = (n: number) =>
    here.filter((p) => p.index === n).map((p) => <NoteLine key={p.row.id} place={p} />);
  return (
    <>
      {blocks.map((block, n) => (
        <Fragment key={n}>
          {before(n)}
          <BlockView block={block} />
        </Fragment>
      ))}
      {here
        .filter((p) => p.index >= blocks.length)
        .map((p) => (
          <NoteLine key={p.row.id} place={p} />
        ))}
    </>
  );
}

/**
 * One message of the analyzer prompt as a document (cv5 Q2): headings, prose, lists, definitions, JSON in the JSON
 * colours, the trace as steps. Every character of the raw message is in the page (a closed section is hidden, not
 * removed). Lines that the last settings change added carry `data-added`, inside their own section. A section that is
 * not in the prompt shows one note line at its place (cv5 N, `data-ui-note`): interface text, not prompt text.
 */
export function PromptDocument({
  doc,
  added,
  change,
  jump,
  prefix,
  peek = null,
  notes,
}: {
  doc: PromptDoc;
  added?: ReadonlySet<number>;
  change: object | null;
  jump: DocState['jump'];
  prefix: string;
  peek?: ReadonlySet<string> | null;
  /** cv5 N: the sections that are not in this message, each shown as one quiet line at its place. */
  notes?: NotePlace[];
}) {
  const byContainer = useMemo(() => {
    if (!notes?.length) return NO_NOTES;
    const map = new Map<string, NotePlace[]>();
    for (const p of notes) {
      const k = p.container ?? '';
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return map;
  }, [notes]);
  return (
    <Ctx.Provider value={{ added, change, jump, prefix, peek, notes: byContainer }}>
      <div className={s.doc} data-structured={doc.structured ? '' : undefined}>
        <Blocks blocks={doc.blocks} container="" />
      </div>
    </Ctx.Provider>
  );
}
