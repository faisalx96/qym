/** Keyboard-shortcuts dialog with the WCAG 2.1.4 single-key opt-out. */
import { Dialog, Kbd, Switch, Text } from '@/ui';
import { SHORTCUT_HELP, useSingleKeyShortcuts } from './useRunsKeyboard';
import styles from './ShortcutsDialog.module.css';

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [single, setSingle] = useSingleKeyShortcuts();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" size="sm" description="Shortcuts never fire inside inputs, dialogs or open menus." data-testid="shortcuts-dialog">
      <table className={styles.table}>
        <tbody>
          {SHORTCUT_HELP.map((s) => (
            <tr key={s.label}>
              <td className={styles.keys}>
                {s.keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 ? <span className={styles.or}>/</span> : null}
                    <Kbd>{k}</Kbd>
                  </span>
                ))}
              </td>
              <td>
                <Text variant="base" as="span" tone={s.single && !single ? 'muted' : 'secondary'}>
                  {s.label}
                </Text>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.optout}>
        <Switch isSelected={single} onChange={setSingle}>
          Single-key shortcuts (j, k, g, G, x, c, /, ?, 1–4)
        </Switch>
        <Text variant="sm" tone="muted" as="p">
          Turn off if they collide with assistive technology. Arrow keys, Enter and Esc keep working.
        </Text>
      </div>
    </Dialog>
  );
}
