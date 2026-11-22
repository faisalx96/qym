import { Tooltip } from '../Tooltip';
import { IconButton } from './IconButton';

export interface FoldButtonProps {
  /** `open`: Expand all (chevrons apart); `close`: Collapse all (chevrons together). */
  action: 'open' | 'close';
  /** Accessible name; defaults to the tooltip words ("Expand all" / "Collapse all"). */
  label?: string;
  onPress: () => void;
  isDisabled?: boolean;
}

/**
 * Expand all / Collapse all of a key tree, a JSON tree or a span tree as a quiet icon action (G4, owner: "expand all
 * and collapse all shall be subtle icons not full buttons"): the default `IconButton` (24px hit area, muted glyph,
 * green on hover, the focus outline) with the shared `Tooltip` naming the action.
 */
export function FoldButton({ action, label, onPress, isDisabled }: FoldButtonProps) {
  const words = action === 'open' ? 'Expand all' : 'Collapse all';
  const button = (
    <IconButton
      label={label ?? words}
      icon={action === 'open' ? 'unfold' : 'fold'}
      onPress={onPress}
      isDisabled={isDisabled}
      data-fold={action}
    />
  );
  // a disabled button gets no hover, so it has no tooltip (as `Act`)
  return isDisabled ? button : <Tooltip content={words}>{button}</Tooltip>;
}
