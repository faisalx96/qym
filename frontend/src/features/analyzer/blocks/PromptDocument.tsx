import { createContext, useContext, useState, type ReactNode } from 'react';
import { Icon, JsonText } from '@/ui';
import { textDirAttrs } from '@/lib/text';
import { hasMark, lineSpan, type Block, type Line, type ListItem, type PromptDoc, type Section } from '../model/promptDoc';
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
}

const Ctx = createContext<DocState>({ added: undefined, change: null, jump: null, prefix: '' });

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
        <Blocks blocks={section.children} />
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

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, n) => (
        <BlockView key={n} block={block} />
      ))}
    </>
  );
}

/**
 * One message of the analyzer prompt as a document (cv5 Q2): headings, prose, lists, definitions, JSON in the JSON
 * colours, the trace as steps. Every character of the raw message is in the page (a closed section is hidden, not
 * removed). Lines that the last settings change added carry `data-added`, inside their own section.
 */
export function PromptDocument({
  doc,
  added,
  change,
  jump,
  prefix,
}: {
  doc: PromptDoc;
  added?: ReadonlySet<number>;
  change: object | null;
  jump: DocState['jump'];
  prefix: string;
}) {
  return (
    <Ctx.Provider value={{ added, change, jump, prefix }}>
      <div className={s.doc} data-structured={doc.structured ? '' : undefined}>
        <Blocks blocks={doc.blocks} />
      </div>
    </Ctx.Provider>
  );
}
