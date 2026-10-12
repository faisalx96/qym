/** CSV button: loads every filtered body, offers a column picker, downloads <run>_export.csv with a BOM. */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { runKeys } from '@/api/runs';
import { Button, Checkbox, Dialog, Icon, useToast } from '@/ui';
import { buildCsv, discoverColumns, type CsvColumn } from '../../lib/csv';
import { useRunPage } from '../../RunContext';
import type { Row, RunPayload } from '../../types';
import { useItemsUi } from './ItemsUi';
import styles from './CsvExport.module.css';

export function CsvExport() {
  const { items, model, runId, payload } = useRunPage();
  const ui = useItemsUi();
  const qc = useQueryClient();
  const toast = useToast();
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const columns = useMemo(() => (open ? discoverColumns(rows, model) : []), [open, rows, model]);

  const start = async () => {
    const ids = items.map((i) => i.row.item_id);
    setLoading({ done: 0, total: ids.length });
    const timer = setInterval(() => {
      const current = qc.getQueryData<RunPayload>(runKeys.compact(runId));
      const byId = new Map((current?.snapshot.rows ?? []).map((r) => [r.item_id, r]));
      setLoading({ done: ids.filter((id) => byId.get(id)?.__details_loaded).length, total: ids.length });
    }, 300);
    try {
      await ui.details.ensure(ids);
      const current = qc.getQueryData<RunPayload>(runKeys.compact(runId));
      const byId = new Map((current?.snapshot.rows ?? []).map((r) => [r.item_id, r]));
      const full = ids.map((id) => byId.get(id)).filter((r): r is Row => !!r);
      // ensure() settles even when a batch failed; an export of preview-only rows would be silently wrong.
      if (current?.snapshot.detail_mode === 'lazy' && full.some((r) => r.__details_loaded !== true)) {
        throw new Error('item bodies missing');
      }
      setRows(full);
      const cols = discoverColumns(full, model);
      setSelected(new Set(cols.map((c) => c.id)));
      setOpen(true);
    } catch {
      toast.show('Could not load every item for the export.', { tone: 'error' });
    } finally {
      clearInterval(timer);
      setLoading(null);
    }
  };

  const groups = useMemo(() => {
    const map = new Map<string, CsvColumn[]>();
    columns.forEach((c) => map.set(c.group, [...(map.get(c.group) ?? []), c]));
    return Array.from(map.entries());
  }, [columns]);

  const download = () => {
    const chosen = columns.filter((c) => selected.has(c.id));
    const csv = '﻿' + buildCsv(chosen, rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(payload.run.run_name || runId).replace(/[^\w.-]+/g, '_')}_export.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  return (
    <>
      <Button
        size="sm"
        variant="neutral"
        icon={<Icon name="expand" size={12} />}
        onPress={() => void start()}
        loading={!!loading}
        data-testid="csv-button"
      >
        {loading ? `Loading ${loading.done}/${loading.total}` : 'CSV'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Export CSV"
        description={`${rows.length.toLocaleString('en-US')} filtered items. Choose the columns to include.`}
        size="lg"
        footer={
          <>
            <Button variant="neutral" onPress={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              onPress={download}
              isDisabled={selected.size === 0}
              data-testid="csv-download"
            >
              Download {selected.size} columns
            </Button>
          </>
        }
      >
        <div className={styles.tools}>
          <Button size="sm" variant="neutral" onPress={() => setSelected(new Set(columns.map((c) => c.id)))}>
            Select all
          </Button>
          <Button size="sm" variant="neutral" onPress={() => setSelected(new Set())}>
            Select none
          </Button>
        </div>
        <div className={styles.groups}>
          {groups.map(([name, cols]) => (
            <details key={name} open={name === 'Core' || name === 'Content'} className={styles.group}>
              <summary>
                {name}{' '}
                <span className={styles.count}>
                  {cols.filter((c) => selected.has(c.id)).length}/{cols.length}
                </span>
              </summary>
              <div className={styles.cols}>
                {cols.map((c) => (
                  <Checkbox
                    key={c.id}
                    isSelected={selected.has(c.id)}
                    onChange={(on) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  >
                    {c.label}
                  </Checkbox>
                ))}
              </div>
            </details>
          ))}
        </div>
      </Dialog>
    </>
  );
}
