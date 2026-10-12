/** CSV export: loads every filtered row's bodies, then lets the user pick columns (compare.html J7). */
import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Dialog, Text } from '@/ui';
import { useCompare } from '../../CompareContext';
import { resolveRow, useDetailsStore, useDetailsVersion, useEnsureBodies } from '../../hooks/useDetails';
import { buildCompareCsv, discoverExportColumns, type ExportColumn, type ExportItem } from '../../lib/csv';
import styles from './CsvDialog.module.css';

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function CsvDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { model, items } = useCompare();
  const store = useDetailsStore();
  const version = useDetailsVersion();
  const ensure = useEnsureBodies(model.runs);
  const [ready, setReady] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(false);
    void ensure(items.map((i) => i.itemId)).then(() => !cancelled && setReady(true));
    return () => {
      cancelled = true;
    };
  }, [open, ensure, items]);

  const exportItems = useMemo<ExportItem[]>(
    () =>
      ready
        ? items.map((i) => ({
            itemId: i.itemId,
            rows: model.runs.map((run) => resolveRow(store, run, i.itemId).row),
          }))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, items, model.runs, store, version],
  );
  const groups = useMemo(
    () => (ready ? discoverExportColumns(model, exportItems) : []),
    [ready, model, exportItems],
  );
  const isOn = (c: ExportColumn) => checked[c.key] ?? c.checked;
  const selected = groups.flatMap((g) => g.columns).filter(isOn);
  const setGroup = (cols: ExportColumn[], on: boolean) =>
    setChecked((s) => ({ ...s, ...Object.fromEntries(cols.map((c) => [c.key, on])) }));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Export CSV"
      description={`${items.length} filtered item${items.length === 1 ? '' : 's'} across ${model.runs.length} runs`}
      footer={
        <>
          <Button variant="neutral" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="accent"
            isDisabled={!ready || !selected.length}
            onPress={() => {
              download('compare_export.csv', buildCompareCsv(model, exportItems, selected));
              onOpenChange(false);
            }}
          >
            Export {selected.length ? `${selected.length} columns` : ''}
          </Button>
        </>
      }
    >
      {!ready ? (
        <Text variant="base" tone="muted" role="status">
          Loading item bodies…
        </Text>
      ) : (
        <div className={styles.groups}>
          <div className={styles.top}>
            <Button
              size="sm"
              variant="neutral"
              onPress={() =>
                setGroup(
                  groups.flatMap((g) => g.columns),
                  true,
                )
              }
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="neutral"
              onPress={() =>
                setGroup(
                  groups.flatMap((g) => g.columns),
                  false,
                )
              }
            >
              Deselect all
            </Button>
          </div>
          {groups.map((g) => {
            const on = g.columns.filter(isOn).length;
            const closed = collapsed.has(g.group);
            return (
              <fieldset key={g.group} className={styles.group}>
                <legend className={styles.legend}>
                  <Checkbox
                    isSelected={on === g.columns.length}
                    isIndeterminate={on > 0 && on < g.columns.length}
                    onChange={(v) => setGroup(g.columns, v)}
                  >
                    {g.group}
                  </Checkbox>
                  <button
                    type="button"
                    className={styles.toggle}
                    aria-expanded={!closed}
                    onClick={() =>
                      setCollapsed((s) => {
                        const n = new Set(s);
                        if (closed) n.delete(g.group);
                        else n.add(g.group);
                        return n;
                      })
                    }
                  >
                    {closed ? 'Show' : 'Hide'} {g.columns.length} columns
                  </button>
                </legend>
                {closed ? null : (
                  <div className={styles.cols}>
                    {g.columns.map((c) => (
                      <Checkbox
                        key={c.key}
                        isSelected={isOn(c)}
                        onChange={(v) => setChecked((s) => ({ ...s, [c.key]: v }))}
                      >
                        {c.label}
                      </Checkbox>
                    ))}
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
