import { useCallback } from 'react';
import { textDirAttrs } from '@/lib/text';

/** `dir` for a block of user text (rtl for mostly-Arabic text, else auto). */
export function useRunDirection() {
  return useCallback(
    (text: string): 'rtl' | 'auto' => (textDirAttrs(text).dir === 'rtl' ? 'rtl' : 'auto'),
    [],
  );
}
