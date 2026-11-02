import { useEffect, useRef, useState } from 'react';
import { copyText } from '@/lib/copy';
import { IconButton } from '../IconButton';
import { Icon, type IconName } from '../Icon';

export interface CopyButtonProps {
  text: string | (() => string);
  label?: string;
  /** Idle glyph (default the copy glyph); e.g. 'link' for a copy-link action. */
  icon?: IconName;
  className?: string;
  onCopied?: () => void;
}

/** Shared copy glyph; flips to "Copied" for 1.5 s. */
export function CopyButton({ text, label = 'Copy', icon = 'copy', className, onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <IconButton
      label={copied ? 'Copied' : label}
      icon={<Icon name={copied ? 'check' : icon} size={14} />}
      active={copied}
      className={className}
      onPress={async () => {
        const ok = await copyText(typeof text === 'function' ? text() : text);
        if (!ok) return;
        setCopied(true);
        onCopied?.();
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}
