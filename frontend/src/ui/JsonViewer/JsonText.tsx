import { useMemo, type ReactNode } from 'react';
import styles from './JsonViewer.module.css';

const TOKEN = String.raw`("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)`;

/**
 * JSON text exactly as written, token-coloured with the JSON viewer's colours (`--json-*`, cv5 H3): keys, strings,
 * numbers, true/false, null; everything else in the punctuation colour. No innerHTML, no reformatting, so it can
 * colour one line of a larger JSON text (the analyzer's rendered prompt, cv5 Q2).
 */
export function JsonText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    const token = new RegExp(TOKEN, 'g');
    let last = 0;
    let k = 0;
    let m: RegExpExecArray | null;
    while ((m = token.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] !== undefined) {
        out.push(
          <span key={k++} className={m[2] ? styles.key : styles.string}>
            {m[1]}
          </span>,
        );
        if (m[2]) out.push(m[2]);
      } else if (m[3] !== undefined)
        out.push(
          <span key={k++} className={m[3] === 'null' ? styles.null : styles.boolean}>
            {m[3]}
          </span>,
        );
      else
        out.push(
          <span key={k++} className={styles.number}>
            {m[4]}
          </span>,
        );
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }, [text]);
  return <span className={styles.punct}>{parts}</span>;
}
