/**
 * The analyzer prompt as a document for a person (cv5 Q2). The parser reads the markers that the platform's prompt
 * builder writes (`packages/platform/qym_platform/services/llm_analyzer.py`: `DEFAULT_SYSTEM_PROMPT`,
 * `build_analysis_prompt`, `_format_item_context`, `_organize_trace_content`, `_format_analysis_rules`) and gives each
 * line of the prompt exactly one place in a tree of sections and blocks. It never drops or changes a line: the leaves,
 * in order, are the raw lines (`flattenLines(doc)` joined with "\n" is the raw text). A part that does not match the
 * known structure becomes plain paragraphs; a failure of the parser gives one plain block for the whole message.
 */

/** One raw line of a message, with its index in the message (the index the change marks use). */
export interface Line {
  i: number;
  text: string;
}

export type Block =
  | { kind: 'blank'; lines: Line[] }
  /** Prose: one or more lines, shown with their line breaks. `indent` leading spaces are layout, not text. */
  | { kind: 'para'; lines: Line[]; indent: number }
  /** Data that a person wrote or a tool returned, kept exactly as it is (sans, own direction). */
  | { kind: 'text'; lines: Line[]; indent: number }
  /** JSON or code, mono, the JSON colours when `json`. */
  | { kind: 'code'; lines: Line[]; indent: number; json: boolean }
  /** "1. category - the broad failure category." / "root_cause_reason - explain ...": a response field. */
  | { kind: 'term'; line: Line; marker: string; term: string; rest: string; indent: number; children: Block[] }
  /** "1. Renamed columns" then its instruction lines (a project rule). */
  | { kind: 'numbered'; head: Line; marker: string; title: string; body: Line[]; indent: number }
  /** "- Schema Misunderstanding" items, each with the indented lines under it. */
  | { kind: 'list'; items: ListItem[] }
  /** "  Schema Misunderstanding:" then the more-indented lines under it. */
  | { kind: 'group'; head: Line; label: string; indent: number; children: Block[] }
  /** "Description: ..." / "Use when: ..." lines: a definition grid. */
  | { kind: 'facts'; rows: { line: Line; key: string; value: string }[] }
  /** A Markdown heading of a reference document. */
  | { kind: 'mdHeading'; line: Line; level: number }
  /** A "---" separator line. */
  | { kind: 'rule'; line: Line }
  | Section;

export interface ListItem {
  head: Line;
  marker: string;
  text: string;
  indent: number;
  children: Block[];
}

export type SectionRole =
  | 'section' // a top-level block of the system prompt (ANALYSIS RULES, EVALUATION ITEM DATA, ...)
  | 'field' // a part of the item data (INPUT, TRACE EVIDENCE, SELECTED METRIC RESULT, ...)
  | 'document' // one reference document
  | 'traceGroup' // "Agent trace:" / "Evaluation trace:"
  | 'step' // "Step 1 — name:"
  | 'part'; // CALL / OUTPUT / THINKING, or a message role inside a step

export interface Section {
  kind: 'section';
  role: SectionRole;
  /** Stable within one message: the index of the heading line (`s<line>`). */
  id: string;
  head: Line;
  /** The heading text as written, without the trailing colon (shown as it is). */
  title: string;
  /** The rest of the heading line after the title (":" or ""), shown muted. */
  tail: string;
  /** A short name for the outline (interface text, not prompt text). */
  label: string;
  /** Known name of the block (for the Prompt contents switches), e.g. "TRACE EVIDENCE". */
  key: string | null;
  children: Block[];
}

export interface PromptDoc {
  blocks: Block[];
  /** False when the parser failed and the whole message is one plain block. */
  structured: boolean;
}

/* ───────────────────────── markers of the prompt builder ───────────────────────── */

/** Top-level blocks that the builder writes (default template, fallback sections, additional instructions). */
const TOP_KNOWN: { re: RegExp; key: string; label: string }[] = [
  { re: /^ANALYSIS RULES\b[^\n]*:\s*$/, key: 'ANALYSIS RULES', label: 'Analysis rules' },
  { re: /^EVALUATION ITEM DATA:\s*$/, key: 'EVALUATION ITEM DATA', label: 'Item data' },
  { re: /^REFERENCE DOCUMENTS:\s*$/, key: 'REFERENCE DOCUMENTS', label: 'Reference documents' },
  { re: /^ROOT CAUSE CATEGORIES:\s*$/, key: 'ROOT CAUSE CATEGORIES', label: 'Categories' },
  { re: /^MAXIMUM ROOT-CAUSE CATEGORIES:\s*$/, key: 'MAXIMUM ROOT-CAUSE CATEGORIES', label: 'Maximum issues' },
  { re: /^SUPPLIED ANALYSIS DATA\s*$/, key: 'SUPPLIED ANALYSIS DATA', label: 'Supplied data' },
  { re: /^Additional Instructions:\s*$/, key: 'Additional Instructions', label: 'Additional instructions' },
  { re: /^Respond ONLY with valid JSON\b[^\n]*:\s*$/, key: 'RESPONSE FORMAT', label: 'Response format' },
];

/** The parts of EVALUATION ITEM DATA (`_format_item_context`), in the builder's order. */
const FIELD_KNOWN: { re: RegExp; key: string; label: string }[] = [
  { re: /^INPUT:\s*$/, key: 'INPUT', label: 'Input' },
  { re: /^EXPECTED OUTPUT:\s*$/, key: 'EXPECTED OUTPUT', label: 'Expected output' },
  { re: /^ACTUAL OUTPUT:\s*$/, key: 'ACTUAL OUTPUT', label: 'Actual output' },
  { re: /^ERROR:\s*$/, key: 'ERROR', label: 'Error' },
  { re: /^TRACE EVIDENCE:\s*$/, key: 'TRACE EVIDENCE', label: 'Trace evidence' },
  { re: /^SELECTED METRIC RESULT:\s*$/, key: 'SELECTED METRIC RESULT', label: 'Metric result' },
  { re: /^ITEM METADATA:\s*$/, key: 'ITEM METADATA', label: 'Item metadata' },
  { re: /^SELECTED METADATA:\s*$/, key: 'SELECTED METADATA', label: 'Selected metadata' },
];

/** Any other all-caps heading line of a custom template ("CONTEXT:", "OUTPUT RULES (strict):"). */
const GENERIC_HEADING = /^[A-Z][A-Z0-9&/_-]*(?:[ \t]+[A-Z0-9&/_-]+)*(?:[ \t]*\([^()\n]*\))?:\s*$/;

const TRACE_GROUP = /^(Agent trace|Evaluation trace):\s*$/;
const TRACE_STEP = /^Step \d+ — .+:\s*$/;
const TRACE_PART = /^(CALL|OUTPUT|THINKING):\s*$/;
const DOCUMENT = /^DOCUMENT: (.*)$/;
/** The last line of the user message (`build_analysis_prompt`). */
const END_LINE = /^Return only the JSON object required by the system prompt\.\s*$/;

const BULLET = /^(\s*)([-*•])\s+(\S.*)$/;
const NUMBERED = /^(\s*)(\d{1,3}\.)\s+(\S.*)$/;
const TERM = /^(\s*)(?:(\d{1,3}\.)\s+)?([a-z][a-z0-9_]*) - (\S.*)$/;
const FACT = /^(\s*)([A-Z][A-Za-z][A-Za-z -]{0,30}):[ \t]+(\S.*)$/;
const LABEL = /^(\s*)(\S[^:\n]{0,80}):\s*$/;
const MD_HEADING = /^(#{1,6})\s+\S/;
const RULE = /^\s*-{3,}\s*$/;

/* ───────────────────────── helpers ───────────────────────── */

const isBlank = (line: Line | undefined) => !line || line.text.trim() === '';
const indentOf = (text: string) => text.length - text.trimStart().length;
const titleOf = (text: string) => {
  const trimmed = text.trimEnd();
  return trimmed.endsWith(':') ? { title: trimmed.slice(0, -1), tail: text.slice(trimmed.length - 1) } : { title: trimmed, tail: text.slice(trimmed.length) };
};
const sentenceCase = (text: string) => {
  const base = text.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  return base.charAt(0).toUpperCase() + base.slice(1);
};

function section(role: SectionRole, head: Line, children: Block[], key: string | null, label?: string): Section {
  const { title, tail } = titleOf(head.text);
  return { kind: 'section', role, id: `s${head.i}`, head, title, tail, label: label ?? sentenceCase(title), key, children };
}

/** The index where a JSON value that starts at `from` closes (bracket balance outside strings), or -1. */
function jsonEnd(lines: Line[], from: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let n = from; n < lines.length; n += 1) {
    for (const ch of lines[n]!.text) {
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) return n;
        if (depth < 0) return -1;
      }
    }
  }
  return -1;
}

const startsJson = (text: string) => /^\s*[[{]/.test(text);

/** Splits `lines` at heading lines (a heading starts a block when the line before it is blank, a heading or absent). */
function splitAt(lines: Line[], isHead: (line: Line) => boolean) {
  const lead: Line[] = [];
  const parts: { head: Line; body: Line[] }[] = [];
  lines.forEach((line, n) => {
    const prev = lines[n - 1];
    if (isHead(line) && (n === 0 || isBlank(prev) || (prev && isHead(prev)))) parts.push({ head: line, body: [] });
    else if (parts.length) parts[parts.length - 1]!.body.push(line);
    else lead.push(line);
  });
  return { lead, parts };
}

/* ───────────────────────── prose ───────────────────────── */

/** Prose with lists, response fields, numbered rules, definitions, JSON and Markdown (default and custom templates). */
export function parseProse(lines: Line[], nested = false): Block[] {
  const out: Block[] = [];
  let n = 0;
  const push = (block: Block) => out.push(block);
  while (n < lines.length) {
    const line = lines[n]!;
    const text = line.text;
    const indent = indentOf(text);
    if (isBlank(line)) {
      const run: Line[] = [];
      while (n < lines.length && isBlank(lines[n])) run.push(lines[n++]!);
      push({ kind: 'blank', lines: run });
      continue;
    }
    if (startsJson(text)) {
      const end = jsonEnd(lines, n);
      if (end >= 0) {
        push({ kind: 'code', lines: lines.slice(n, end + 1), indent, json: true });
        n = end + 1;
        continue;
      }
    }
    if (/^\s*```/.test(text)) {
      let end = n + 1;
      while (end < lines.length && !/^\s*```/.test(lines[end]!.text)) end += 1;
      end = Math.min(end, lines.length - 1);
      push({ kind: 'code', lines: lines.slice(n, end + 1), indent, json: false });
      n = end + 1;
      continue;
    }
    if (/^\s*\|/.test(text)) {
      const run: Line[] = [];
      while (n < lines.length && /^\s*\|/.test(lines[n]!.text)) run.push(lines[n++]!);
      push({ kind: 'code', lines: run, indent, json: false });
      continue;
    }
    if (RULE.test(text)) {
      push({ kind: 'rule', line });
      n += 1;
      continue;
    }
    const md = MD_HEADING.exec(text);
    if (md && indent === 0) {
      push({ kind: 'mdHeading', line, level: md[1]!.length });
      n += 1;
      continue;
    }
    const term = TERM.exec(text);
    if (term) {
      n += 1;
      // the choices listed under a response field ("- Category" items, "  Category:" groups), up to a blank line
      const kids: Line[] = [];
      while (
        n < lines.length &&
        !isBlank(lines[n]) &&
        (indentOf(lines[n]!.text) > indent || BULLET.test(lines[n]!.text))
      )
        kids.push(lines[n++]!);
      push({
        kind: 'term',
        line,
        marker: term[2] ?? '',
        term: term[3]!,
        rest: term[4]!,
        indent,
        children: parseProse(kids, true),
      });
      continue;
    }
    const bullet = BULLET.exec(text);
    if (bullet) {
      const items: ListItem[] = [];
      while (n < lines.length) {
        const b = BULLET.exec(lines[n]!.text);
        if (!b || b[1]!.length !== indent) break;
        const head = lines[n]!;
        n += 1;
        const kids: Line[] = [];
        while (n < lines.length && !isBlank(lines[n]) && indentOf(lines[n]!.text) > indent) kids.push(lines[n++]!);
        items.push({ head, marker: b[2]!, text: b[3]!, indent, children: parseProse(kids, true) });
      }
      push({ kind: 'list', items });
      continue;
    }
    const numbered = NUMBERED.exec(text);
    if (numbered) {
      n += 1;
      const body: Line[] = [];
      // the instruction lines of a rule: plain lines at the same indent, until a blank line or another structure
      while (
        n < lines.length &&
        !isBlank(lines[n]) &&
        indentOf(lines[n]!.text) === indent &&
        !NUMBERED.exec(lines[n]!.text) &&
        !BULLET.exec(lines[n]!.text) &&
        !startsJson(lines[n]!.text)
      )
        body.push(lines[n++]!);
      push({ kind: 'numbered', head: line, marker: numbered[2]!, title: numbered[3]!, body, indent });
      continue;
    }
    const fact = nested ? FACT.exec(text) : null;
    if (fact) {
      const rows: { line: Line; key: string; value: string }[] = [];
      while (n < lines.length) {
        const f = FACT.exec(lines[n]!.text);
        if (!f || indentOf(lines[n]!.text) !== indent) break;
        rows.push({ line: lines[n]!, key: f[2]!, value: f[3]! });
        n += 1;
      }
      push({ kind: 'facts', rows });
      continue;
    }
    const label = LABEL.exec(text);
    const next = lines[n + 1];
    if (label && indent > 0 && next && !isBlank(next) && indentOf(next.text) > indent) {
      n += 1;
      const kids: Line[] = [];
      while (n < lines.length && !isBlank(lines[n]) && indentOf(lines[n]!.text) > indent) kids.push(lines[n++]!);
      push({ kind: 'group', head: line, label: label[2]!, indent, children: parseProse(kids, true) });
      continue;
    }
    // a paragraph: plain lines until a blank line or a line that starts a structure
    const run: Line[] = [line];
    n += 1;
    while (n < lines.length) {
      const t = lines[n]!.text;
      if (
        isBlank(lines[n]) ||
        startsJson(t) ||
        BULLET.test(t) ||
        NUMBERED.test(t) ||
        TERM.test(t) ||
        RULE.test(t) ||
        /^\s*(```|\|)/.test(t) ||
        (MD_HEADING.test(t) && indentOf(t) === 0) ||
        indentOf(t) !== indent
      )
        break;
      run.push(lines[n++]!);
    }
    push({ kind: 'para', lines: run, indent });
  }
  return out;
}

/* ───────────────────────── item data ───────────────────────── */

/** A value that the builder dumped (`_prompt_dump`): JSON when it parses as one block, else the text as it is. */
function parseValue(lines: Line[]): Block[] {
  const out: Block[] = [];
  let n = 0;
  while (n < lines.length) {
    if (isBlank(lines[n])) {
      const run: Line[] = [];
      while (n < lines.length && isBlank(lines[n])) run.push(lines[n++]!);
      out.push({ kind: 'blank', lines: run });
      continue;
    }
    const first = lines[n]!;
    if (startsJson(first.text)) {
      const end = jsonEnd(lines, n);
      if (end >= 0) {
        out.push({ kind: 'code', lines: lines.slice(n, end + 1), indent: indentOf(first.text), json: true });
        n = end + 1;
        continue;
      }
    }
    // text up to the trailing blank lines (a value can hold blank lines of its own)
    let end = lines.length;
    while (end > n && isBlank(lines[end - 1])) end -= 1;
    out.push({ kind: 'text', lines: lines.slice(n, end), indent: indentOf(first.text) });
    n = end;
  }
  return out;
}

/** The lines of a trace value, two more spaces in: JSON, text, or chat messages ("user:", "tool call: name"). */
function parseTraceValue(lines: Line[], indent: number): Block[] {
  const roles = lines.filter((l) => indentOf(l.text) === indent);
  const isMessageHead = (t: string) => /^[a-z_][a-z_ ]*:\s*$/.test(t.trim()) || /^tool call: /.test(t.trim());
  if (roles.length && roles.every((l) => isMessageHead(l.text)) && isMessageHead(lines[0]?.text ?? '')) {
    const out: Block[] = [];
    let n = 0;
    while (n < lines.length) {
      const head = lines[n]!;
      n += 1;
      const kids: Line[] = [];
      while (n < lines.length && indentOf(lines[n]!.text) > indent) kids.push(lines[n++]!);
      const { title, tail } = titleOf(head.text.trim());
      out.push({
        kind: 'section',
        role: 'part',
        id: `s${head.i}`,
        head,
        title,
        tail,
        label: title,
        key: null,
        children: kids.length ? parseTraceValue(kids, indent + 2) : [],
      });
    }
    return out;
  }
  if (startsJson(lines[0]?.text ?? '') && jsonEnd(lines, 0) === lines.length - 1)
    return [{ kind: 'code', lines, indent, json: true }];
  return [{ kind: 'text', lines, indent }];
}

/** TRACE EVIDENCE (`_organize_trace_content`): trace groups, numbered steps, CALL / OUTPUT / THINKING parts. */
function parseTrace(lines: Line[]): Block[] {
  const out: Block[] = [];
  let group: Section | null = null;
  let step: Section | null = null;
  let n = 0;
  const target = () => (step ?? group)?.children ?? out;
  while (n < lines.length) {
    const line = lines[n]!;
    if (TRACE_GROUP.test(line.text)) {
      group = section('traceGroup', line, [], null, line.text.replace(/:\s*$/, ''));
      step = null;
      out.push(group);
      n += 1;
    } else if (TRACE_STEP.test(line.text) && group) {
      step = section('step', line, [], null);
      group.children.push(step);
      n += 1;
    } else if (TRACE_PART.test(line.text) && step) {
      n += 1;
      const body: Line[] = [];
      while (n < lines.length && (lines[n]!.text.startsWith('  ') || (isBlank(lines[n]) && lines[n + 1]?.text.startsWith('  '))))
        body.push(lines[n++]!);
      step.children.push(section('part', line, body.length ? parseTraceValue(body, 2) : [], null, line.text.replace(/:\s*$/, '')));
    } else if (isBlank(line)) {
      const run: Line[] = [];
      while (n < lines.length && isBlank(lines[n])) run.push(lines[n++]!);
      // a blank line ends a trace group's last step: it belongs to the group level
      step = null;
      (group?.children ?? out).push({ kind: 'blank', lines: run });
    } else {
      target().push({ kind: 'text', lines: [line], indent: indentOf(line.text) });
      n += 1;
    }
  }
  return out;
}

function parseItemData(lines: Line[]): Block[] {
  const known = (line: Line) => FIELD_KNOWN.find((f) => f.re.test(line.text));
  const { lead, parts } = splitAt(lines, (line) => Boolean(known(line)));
  const out: Block[] = lead.length ? parseValue(lead) : [];
  for (const { head, body } of parts) {
    const field = known(head)!;
    // the blank lines between two fields close the field before them
    out.push(section('field', head, field.key === 'TRACE EVIDENCE' ? parseTrace(body) : parseValue(body), field.key, field.label));
  }
  return out;
}

function parseDocuments(lines: Line[]): Block[] {
  const { lead, parts } = splitAt(lines, (line) => DOCUMENT.test(line.text));
  const out: Block[] = parseProse(lead);
  for (const { head, body } of parts) {
    const name = DOCUMENT.exec(head.text)![1]!;
    const doc = section('document', head, parseProse(body), null, name || 'document');
    doc.title = head.text;
    doc.tail = '';
    out.push(doc);
  }
  return out;
}

/* ───────────────────────── message ───────────────────────── */

function topKnown(line: Line) {
  return TOP_KNOWN.find((t) => t.re.test(line.text));
}

/** The structure of one message. Never throws: a failure, or a model that would not give back the raw text, is plain. */
export function parsePrompt(content: string): PromptDoc {
  const lines: Line[] = content.split('\n').map((text, i) => ({ i, text }));
  try {
    const blocks = parseLines(lines);
    if (flattenLines(blocks).map((l) => l.text).join('\n') === content) return { blocks, structured: true };
  } catch {
    /* fall through to the plain form */
  }
  return { blocks: plain(lines), structured: false };
}

/** Clean paragraphs, with nothing else assumed: the form for text that does not match the known structure. */
export function plain(lines: Line[]): Block[] {
  const out: Block[] = [];
  let n = 0;
  while (n < lines.length) {
    const blank = isBlank(lines[n]);
    const run: Line[] = [];
    while (n < lines.length && isBlank(lines[n]) === blank) run.push(lines[n++]!);
    out.push(blank ? { kind: 'blank', lines: run } : { kind: 'para', lines: run, indent: 0 });
  }
  return out;
}

function parseLines(lines: Line[]): Block[] {
  // A heading opens a top-level block. Inside the item data and the additional instructions (person-written text),
  // only the builder's own top-level headings end the block, so text inside a value is never read as a heading.
  const out: Block[] = [];
  let current: { head: Line; key: string | null; label: string; body: Line[] } | null = null;
  const lead: Line[] = [];
  const close = () => {
    if (!current) return;
    const { head, key, body, label } = current;
    const children =
      key === 'EVALUATION ITEM DATA'
        ? parseItemData(body)
        : key === 'REFERENCE DOCUMENTS'
          ? parseDocuments(body)
          : parseProse(body);
    out.push(section('section', head, children, key, label));
    current = null;
  };
  const flush = () => {
    if (lead.length) out.push(...parseProse(lead.splice(0)));
  };
  lines.forEach((line, n) => {
    const prev = lines[n - 1];
    const startOk = n === 0 || isBlank(prev);
    // the user message ends with the builder's closing line, after the last document
    if (startOk && END_LINE.test(line.text) && lines.slice(n + 1).every((l) => isBlank(l))) {
      close();
      lead.push(line);
      return;
    }
    const known = startOk ? topKnown(line) : undefined;
    const closed = current?.key === 'EVALUATION ITEM DATA' || current?.key === 'Additional Instructions';
    const generic = startOk && !closed && !known && GENERIC_HEADING.test(line.text) && /[A-Z]{3}/.test(line.text);
    if (known || generic) {
      close();
      flush();
      current = { head: line, key: known?.key ?? null, label: known?.label ?? sentenceCase(titleOf(line.text).title), body: [] };
      return;
    }
    if (current) current.body.push(line);
    else lead.push(line);
  });
  close();
  flush();
  return out;
}

/* ───────────────────────── reading the model ───────────────────────── */

/** Every raw line of the blocks, in order (the round-trip contract: joined with "\n" they are the message). */
export function flattenLines(blocks: Block[]): Line[] {
  const out: Line[] = [];
  const walk = (block: Block) => {
    switch (block.kind) {
      case 'blank':
      case 'para':
      case 'text':
      case 'code':
        out.push(...block.lines);
        break;
      case 'term':
        out.push(block.line);
        block.children.forEach(walk);
        break;
      case 'mdHeading':
      case 'rule':
        out.push(block.line);
        break;
      case 'numbered':
        out.push(block.head, ...block.body);
        break;
      case 'list':
        for (const item of block.items) {
          out.push(item.head);
          item.children.forEach(walk);
        }
        break;
      case 'group':
        out.push(block.head);
        block.children.forEach(walk);
        break;
      case 'facts':
        out.push(...block.rows.map((r) => r.line));
        break;
      case 'section':
        out.push(block.head);
        block.children.forEach(walk);
        break;
    }
  };
  blocks.forEach(walk);
  return out;
}

/** The first and last line index of a block (for line counts and change marks). */
export function lineSpan(block: Block): { first: number; last: number; count: number } {
  const lines = flattenLines([block]);
  const first = lines[0]?.i ?? 0;
  const last = lines[lines.length - 1]?.i ?? first;
  return { first, last, count: lines.filter((l) => l.text.trim() !== '').length };
}

/** True when a block holds a line of `marks`. */
export function hasMark(block: Block, marks: ReadonlySet<number> | undefined): boolean {
  if (!marks?.size) return false;
  return flattenLines([block]).some((l) => marks.has(l.i));
}

export interface OutlineEntry {
  id: string;
  label: string;
  key: string | null;
  depth: 0 | 1;
}

/** The sections a person can jump to: the top-level blocks, and the parts of the item data under it. */
export function outline(doc: PromptDoc): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  for (const block of doc.blocks) {
    if (block.kind !== 'section') continue;
    out.push({ id: block.id, label: block.label, key: block.key, depth: 0 });
    if (block.key === 'EVALUATION ITEM DATA')
      for (const child of block.children)
        if (child.kind === 'section') out.push({ id: child.id, label: child.label, key: child.key, depth: 1 });
  }
  return out;
}
