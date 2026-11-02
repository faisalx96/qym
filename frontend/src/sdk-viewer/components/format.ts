import type { RowStatus } from '../types';

export const STATUS_LABEL: Record<RowStatus, string> = {
  completed: 'Done',
  in_progress: 'Running',
  pending: 'Pending',
  error: 'Error',
};

/** Copy with a fallback for non-secure contexts (the viewer is served over plain http on localhost). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Run timestamps are UTC ISO strings, with or without a zone suffix. */
export function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

export function safeFilename(text: string): string {
  return text.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'run';
}
