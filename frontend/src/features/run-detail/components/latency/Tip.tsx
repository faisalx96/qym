/** The Latency and traces tooltip body is the chart kit's TipBody (C-35); this module keeps cssVars. */
import type { CSSProperties } from 'react';

export { TipBody } from '@/ui/Chart';

/** Custom properties for a style prop (`--x`, `--tone`): CSSProperties does not type them. */
export const cssVars = (vars: Record<string, string | number>): CSSProperties => vars as CSSProperties;
