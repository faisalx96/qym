/**
 * The outline of the rendered prompt (cv5 N, owner 2026-11-14: "this navbar sucks!!"). One tree with two levels under
 * each message: message (System, User) → section → part of the item data. A section that a Prompt contents switch
 * keeps out of the prompt ("not sent"), or that is on but has nothing for this target ("none"), keeps its place in the
 * tree, and the document shows one quiet line at that place. The note lines are interface text: they are never part
 * of the parsed prompt, so the raw round trip and Copy do not see them.
 */
import type { SectionNote } from './contents';
import {
  closingIndex,
  flattenLines,
  hasMark,
  type Block,
  type Line,
  type PromptDoc,
  type Section,
} from './promptDoc';

export type RowState = 'off' | 'empty';

export interface OutlineRow {
  /** The message index. */
  message: number;
  /** DOM id suffix inside the message: a section id, `top` (the system message's opening prose) or `note-…`. */
  id: string;
  label: string;
  key: string | null;
  depth: 0 | 1;
  /** The section ids that a jump opens (a part of the item data opens the item data too). */
  path: string[];
  /** The id of the depth-0 row above a depth-1 row. */
  parent: string | null;
  /** "off" = its switch is off (not sent); "empty" = on, but this target has none. */
  state: RowState | null;
  /** The section is not in the prompt: the document shows a note line in its place. */
  note: boolean;
  /** The section holds a line that the last settings change added. */
  changed: boolean;
}

export interface OutlineGroup {
  message: number;
  /** The message name as the person reads it: System, User. */
  name: string;
  rows: OutlineRow[];
}

/** A note line of the document: in `container` (a section id, or null for the message's top level), before block `index`. */
export interface NotePlace {
  row: OutlineRow;
  container: string | null;
  index: number;
}

export interface MessageOutline {
  group: OutlineGroup;
  notes: NotePlace[];
}

/** The builder's order of the sections (`build_analysis_prompt`), to place a section that is not in the prompt. */
export const SECTION_ORDER = [
  'ANALYSIS RULES',
  'EVALUATION ITEM DATA',
  'INPUT',
  'EXPECTED OUTPUT',
  'ACTUAL OUTPUT',
  'ERROR',
  'TRACE EVIDENCE',
  'SELECTED METRIC RESULT',
  'ITEM METADATA',
  'SELECTED METRIC METADATA',
  'SELECTED METADATA',
  'RESPONSE FORMAT',
  'REFERENCE DOCUMENTS',
];

const ITEM_DATA = 'EVALUATION ITEM DATA';

/** SELECTED METADATA is the older name of the metric metadata block: one switch, one row. */
const sameKey = (a: string | null, b: string | null) =>
  a === b ||
  (a === 'SELECTED METRIC METADATA' && b === 'SELECTED METADATA') ||
  (a === 'SELECTED METADATA' && b === 'SELECTED METRIC METADATA');

const rankOf = (key: string | null) => (key ? SECTION_ORDER.indexOf(key) : -1);

export const messageName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

const noteId = (key: string) => `note-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

type Slot =
  | { kind: 'section'; section: Section; index: number; rank: number }
  | { kind: 'note'; note: SectionNote; index: number };

/**
 * The sections of one container in document order, with the missing sections placed by the builder's order: before
 * the first section that comes later, else at the end (the top level: after the last section, before the closing line).
 */
function place(blocks: Block[], missing: SectionNote[], topLevel: boolean): Slot[] {
  const slots: Slot[] = [];
  let last = -1;
  let lastIndex = -1;
  blocks.forEach((block, index) => {
    if (block.kind !== 'section') return;
    const r = rankOf(block.key);
    // a section of a custom template keeps its place after the one before it
    last = r >= 0 ? r : last + 0.001;
    lastIndex = index;
    slots.push({ kind: 'section', section: block, index, rank: last });
  });
  const end = topLevel
    ? lastIndex >= 0
      ? lastIndex + 1
      : (() => {
          const close = closingIndex(blocks);
          return close >= 0 ? close : blocks.length;
        })()
    : blocks.length;
  for (const note of [...missing].sort((a, b) => rankOf(a.key) - rankOf(b.key))) {
    const at = slots.findIndex((s) => s.kind === 'section' && s.rank > rankOf(note.key));
    if (at >= 0) slots.splice(at, 0, { kind: 'note', note, index: slots[at]!.index });
    else slots.push({ kind: 'note', note, index: end });
  }
  return slots;
}

/** The lines of a section outside its child sections (the item data's own heading, not its parts). */
function ownLines(section: Section): Line[] {
  return [section.head, ...flattenLines(section.children.filter((b) => b.kind !== 'section'))];
}

const marked = (lines: Line[], added: ReadonlySet<number> | undefined) =>
  Boolean(added?.size) && lines.some((l) => added!.has(l.i));

/**
 * The outline of one message: its rows, and the note lines of the sections that are not in it. `notes` are the
 * Prompt contents sections of this message (`sectionNotes`, filtered by message); `added` the line indexes of the
 * last change.
 */
export function messageOutline(
  doc: PromptDoc,
  message: number,
  role: string,
  notes: SectionNote[],
  added?: ReadonlySet<number>,
): MessageOutline {
  const top = doc.blocks;
  const data = top.find((b): b is Section => b.kind === 'section' && b.key === ITEM_DATA) ?? null;
  const present: (string | null)[] = [];
  for (const b of top)
    if (b.kind === 'section') {
      present.push(b.key);
      if (b === data) for (const c of b.children) if (c.kind === 'section') present.push(c.key);
    }
  const noteOf = (key: string | null) => notes.find((n) => sameKey(n.key, key));
  const missing = notes.filter((n) => !present.some((k) => sameKey(n.key, k)));
  const inData = data ? missing.filter((n) => n.parent === ITEM_DATA) : [];
  const atTop = missing.filter((n) => !inData.includes(n));

  const rows: OutlineRow[] = [];
  const places: NotePlace[] = [];
  const lead = top.find((b) => b.kind !== 'blank');
  if (message === 0 && lead && lead.kind !== 'section') {
    // the system message's opening prose (the user message's closing line needs no row)
    const first = top.findIndex((b) => b.kind === 'section');
    const leadLines = flattenLines(first >= 0 ? top.slice(0, first) : top);
    rows.push(row(message, 'top', 'Instructions', null, 0, [], null, null, false, marked(leadLines, added)));
  }

  const noteRow = (
    note: SectionNote,
    depth: 0 | 1,
    parent: Section | null,
    container: string | null,
    index: number,
  ) => {
    const r = row(
      message,
      noteId(note.key),
      note.label,
      note.key,
      depth,
      parent ? [parent.id] : [],
      parent?.id ?? null,
      note.state,
      true,
      false,
    );
    rows.push(r);
    places.push({ row: r, container, index });
  };

  for (const slot of place(top, atTop, true)) {
    if (slot.kind === 'note') {
      noteRow(slot.note, 0, null, null, slot.index);
      continue;
    }
    const { section } = slot;
    const off = noteOf(section.key)?.state === 'off' ? 'off' : null;
    const isData = section === data;
    rows.push(
      row(
        message,
        section.id,
        section.label,
        section.key,
        0,
        [section.id],
        null,
        off,
        false,
        isData ? marked(ownLines(section), added) : hasMark(section, added),
      ),
    );
    if (!isData) continue;
    for (const child of place(section.children, inData, false)) {
      if (child.kind === 'note') {
        noteRow(child.note, 1, section, section.id, child.index);
        continue;
      }
      const c = child.section;
      rows.push(
        row(
          message,
          c.id,
          c.label,
          c.key,
          1,
          [section.id, c.id],
          section.id,
          noteOf(c.key)?.state === 'off' ? 'off' : null,
          false,
          hasMark(c, added),
        ),
      );
    }
  }
  return { group: { message, name: messageName(role), rows }, notes: places };
}

function row(
  message: number,
  id: string,
  label: string,
  key: string | null,
  depth: 0 | 1,
  path: string[],
  parent: string | null,
  state: RowState | null,
  note: boolean,
  changed: boolean,
): OutlineRow {
  return { message, id, label, key, depth, path, parent, state, note, changed };
}

/** The location of a row as the person reads it: message, then the section, then the part ("System · Item data · Input"). */
export function locationOf(group: OutlineGroup, row: OutlineRow): string[] {
  const parent = row.parent ? group.rows.find((r) => r.id === row.parent) : undefined;
  return [group.name, ...(parent ? [parent.label] : []), row.label];
}

/** The quiet word at a row's end: "not sent" or "none". */
export const stateText = (state: RowState | null) =>
  state === 'off' ? 'not sent' : state === 'empty' ? 'none' : '';
