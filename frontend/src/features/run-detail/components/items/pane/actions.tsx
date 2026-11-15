/**
 * The icon actions of an item pane, in the platform's icon action recipe (DESIGN_LANGUAGE §3.1): a plain glyph with
 * its name on hover and on keyboard focus. Only a row action of a table (the score edit of a metric row) is a tile.
 */
import { useEffect, useState } from 'react';
import { IconButton, Tooltip, type IconButtonProps, type IconName } from '@/ui';

/** An icon action with a tooltip. A locked action shows its reason in place of the tooltip. */
export function Act(props: IconButtonProps) {
  const button = <IconButton {...props} />;
  if (props.isDisabled) return button;
  return <Tooltip content={props.label}>{button}</Tooltip>;
}

/** Copy a text: the glyph is a check for a moment after a copy. */
export function CopyAct({ text, label, icon = 'copy' }: { text: string; label: string; icon?: IconName }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <Act
      label={copied ? 'Copied' : label}
      icon={copied ? 'check' : icon}
      onPress={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    />
  );
}
