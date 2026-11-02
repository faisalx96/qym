import type { SettingsNode } from '../model';

/** Changed leaves under a list of nodes (the group header's "N changed"). */
export function countChanged(nodes: readonly SettingsNode[]): number {
  let n = 0;
  for (const nd of nodes) {
    if (nd.type === 'leaf') n += nd.changed ? 1 : 0;
    else if (nd.type === 'object') {
      n += countChanged(nd.children);
      for (const item of nd.extra?.items ?? []) n += countChanged([item.node]);
    } else if (nd.type === 'collection') for (const item of nd.items) n += countChanged(item.children);
    else for (const row of nd.rows) n += row.cells.filter((c) => c.changed).length;
  }
  return n;
}
