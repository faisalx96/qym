import type { StatusShape, StatusTone } from '@/ui';

/** An item outcome's StatusMark (tone, figure): the pixel figure is the non-colour cue (B-10, the run Items map). */
export const VERDICT_MARK: Record<string, [StatusTone, StatusShape]> = {
  pass: ['success', 'check'],
  fail: ['danger', 'cross'],
  error: ['danger', 'cross'],
  not_received: ['warning', 'pause'],
  running: ['info', 'orbit'],
};
