import { useMemo } from 'react';
import { getTextMode, looksLikeCode, renderMarkdown, textDirAttrs, type TextMode } from '@/lib/text';
import styles from './TextBlock.module.css';

export interface TextBlockProps {
  text: string | null | undefined;
  /** 'raw' | 'rendered' (safe markdown subset). Defaults to the stored preference. */
  mode?: TextMode;
  /** Force code presentation; otherwise detected. */
  code?: boolean;
  className?: string;
  /** Override detected direction. */
  dir?: 'rtl' | 'ltr' | 'auto';
}

export function useTextDirection(text: unknown) {
  return useMemo(() => textDirAttrs(text), [text]);
}

/**
 * Shows user/model text safely: direction + lang on the block element,
 * pre-wrap, mono for code, optional rendered markdown (escaped subset).
 * The only place dangerouslySetInnerHTML is allowed (eslint rule).
 */
export function TextBlock({ text, mode, code, className, dir }: TextBlockProps) {
  const value = String(text ?? '');
  const detected = useTextDirection(value);
  const isCode = code ?? looksLikeCode(value);
  const effectiveMode: TextMode = mode ?? getTextMode();
  const rendered = effectiveMode === 'rendered' && !isCode;
  const attrs = dir ? { dir, lang: dir === 'rtl' ? ('ar' as const) : undefined } : detected;
  const cls = [styles.block, isCode ? styles.code : styles.prose, className].filter(Boolean).join(' ');
  if (rendered) {
    return (
      <div
        className={cls}
        data-text-mode="rendered"
        {...attrs}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
      />
    );
  }
  return (
    <div className={cls} data-text-mode="raw" {...attrs}>
      {value}
    </div>
  );
}
