import { Button } from '../Button';
import { Icon } from '../Icon';
import styles from './ClearFiltersButton.module.css';

export type ClearFiltersButtonProps = {
  count: number;
  onClear: () => void;
  /** Default "filters-clear". */
  testId?: string;
} & { [key: `data-${string}`]: string | undefined };

/**
 * `× Clear n` (D-16): resets every filter and the search of a filter bar; red, so it reads as the one undo for the whole
 * bar. n = active filters, plus 1 when the search has text. Renders nothing when there is nothing to clear.
 */
export function ClearFiltersButton({
  count,
  onClear,
  testId = 'filters-clear',
  ...data
}: ClearFiltersButtonProps) {
  if (count <= 0) return null;
  return (
    <Button
      variant="danger"
      icon={<Icon name="close" size={12} />}
      onPress={onClear}
      className={styles.clear}
      aria-label={`Clear ${count} filter${count === 1 ? '' : 's'}`}
      data-testid={testId}
      {...data}
    >
      Clear <span className={styles.clearCount}>{count}</span>
    </Button>
  );
}
