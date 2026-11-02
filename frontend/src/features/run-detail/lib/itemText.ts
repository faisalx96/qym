/** Text shown for item bodies and the labels around them. */
export function bodyText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function formatStartedAt(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

/** Link to one item of this run (and pass): the page URL with ?item=. */
export function itemLink(pathname: string, itemId: string, pass: number | null, origin: string): string {
  const params = new URLSearchParams({ item: itemId });
  if (pass) params.set('pass', String(pass));
  return `${origin}${pathname}?${params.toString()}`;
}
