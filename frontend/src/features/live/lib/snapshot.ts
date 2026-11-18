/**
 * Chart snapshots: the drawn chart as stored markup. Its text comes from model output, so it is
 * untrusted and is only ever drawn inside a sandboxed frame, never placed in the app's own document.
 */

/** Inside the frame: no network and no script; only the inline stylesheet and data: fonts and images. */
export const SNAPSHOT_CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:";

const EMPTY_HEAD = '<head></head>';

/**
 * The document for the frame's `srcdoc`, or null when the markup lacks the single empty head that qym stores.
 *
 * qym's own head is written before any stored byte, and the stored markup follows unchanged. A browser ignores
 * a policy <meta> outside the real head, so the policy must never sit where the stored markup says its head
 * is: an element, a comment or a text area ahead of that place would move it into the body. Written first, it
 * is in the head whatever follows. The stored <html ...> tag then only adds its attributes to the root
 * element, and its own empty head is ignored.
 *
 * The stylesheet goes into one <style>; every `</style` inside it is broken so it cannot end that element.
 */
export function snapshotDocument(html: string, css: string): string | null {
  const at = html.indexOf(EMPTY_HEAD);
  if (at < 0 || html.indexOf(EMPTY_HEAD, at + EMPTY_HEAD.length) >= 0) return null;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${SNAPSHOT_CSP}">` +
    `<style>${css.replace(/<\/(style)/gi, '<\\/$1')}</style></head>` +
    html
  );
}

export interface SnapshotGeometry {
  viewport_width: number;
  viewport_height?: number | null;
  box: { x: number; y: number; width: number; height: number };
}

export interface SnapshotLayout {
  /** 0 until the available space is known; the frame stays hidden then. */
  scale: number;
  /** The visible region, in CSS pixels of the page. */
  clip: { width: number; height: number };
  /** The frame is laid out at the captured page size, then moved and scaled so the box fills the clip. */
  frame: { width: number; height: number; transform: string };
}

/** `width` fills the available width; `contain` fits both sides, as object-fit: contain does for a picture. */
export function snapshotLayout(
  { viewport_width, viewport_height, box }: SnapshotGeometry,
  available: { width: number; height: number },
  fit: 'width' | 'contain',
): SnapshotLayout {
  const byWidth = available.width / box.width;
  const fitted = fit === 'contain' ? Math.min(byWidth, available.height / box.height) : byWidth;
  const scale = Number.isFinite(fitted) && fitted > 0 ? fitted : 0;
  // `contain` never exceeds the space it was fitted to, whatever the rounding of the scale.
  const within = (size: number, limit: number) => (fit === 'contain' ? Math.min(size, limit) : size);
  return {
    scale,
    clip: {
      width: within(box.width * scale, available.width),
      height: within(box.height * scale, available.height),
    },
    frame: {
      width: viewport_width,
      // The captured height when it is known: a page background can depend on it. Never less than
      // the bottom of the box, or the frame itself would cut the chart.
      height: Math.max(viewport_height ?? 0, Math.ceil(box.y + box.height)),
      transform: `translate(${-box.x * scale}px, ${-box.y * scale}px) scale(${scale})`,
    },
  };
}
