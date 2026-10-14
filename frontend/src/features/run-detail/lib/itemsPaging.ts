/** A big run opens at 100 rows (not 138 pages of 20); the reader's own stored choice always wins. */
export function defaultPageSize(total: number): number {
  return total >= 1000 ? 100 : 20;
}
