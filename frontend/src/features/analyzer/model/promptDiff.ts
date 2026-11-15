/** What a settings change did to the prompt messages (cv5 K3): a line count diff, cheap enough for every update. */

export interface LineChange {
  /** For each message of the new prompt, the indexes of its lines that the old prompt did not have. */
  added: Set<number>[];
  addedCount: number;
  removedCount: number;
}

interface Message {
  role: string;
  content: string;
}

/**
 * Compares two prompts message by message (same position) as multisets of lines: a line that is in the new message
 * more often than in the old one is added, the opposite is removed. Blank lines are not counted. A moved line is not
 * a change.
 */
export function changedLines(before: readonly Message[], after: readonly Message[]): LineChange {
  let addedCount = 0;
  let removedCount = 0;
  const added = after.map((message, i) => {
    const old = before[i];
    const pool = new Map<string, number>();
    if (old && old.role === message.role)
      for (const line of old.content.split('\n')) pool.set(line, (pool.get(line) ?? 0) + 1);
    const marks = new Set<number>();
    message.content.split('\n').forEach((line, index) => {
      const left = pool.get(line) ?? 0;
      if (left > 0) pool.set(line, left - 1);
      else if (line.trim()) {
        marks.add(index);
        addedCount += 1;
      }
    });
    for (const [line, left] of pool) if (line.trim()) removedCount += left;
    return marks;
  });
  // Messages that the new prompt no longer has.
  for (let i = after.length; i < before.length; i += 1)
    removedCount += (before[i]?.content.split('\n') ?? []).filter((l) => l.trim()).length;
  // A message whose role changed at the same position: its old lines are all removed.
  after.forEach((message, i) => {
    const old = before[i];
    if (old && old.role !== message.role)
      removedCount += old.content.split('\n').filter((l) => l.trim()).length;
  });
  return { added, addedCount, removedCount };
}
