/** Promise-style confirmation on top of ConfirmDialog: `if (!(await ask({...}))) return;`. */
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmDialogProps } from '@/ui';

export type AskOptions = Pick<
  ConfirmDialogProps,
  'title' | 'description' | 'warning' | 'confirmLabel' | 'cancelLabel' | 'tone'
>;

export function usePromiseConfirm(): { ask: (options: AskOptions) => Promise<boolean>; dialog: ReactNode } {
  const [request, setRequest] = useState<AskOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const ask = useCallback(
    (options: AskOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setRequest(options);
        setOpen(true);
      }),
    [],
  );

  const dialog = request ? (
    <ConfirmDialog
      {...request}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) settle(false); // no-op when already confirmed
      }}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;
  return { ask, dialog };
}
