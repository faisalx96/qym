/** Merge a row the server returned (score edit, issue edit) into the details store and the compare cache. */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Row } from '@/features/run-detail/types';
import type { ComparePayload } from '../lib/model';
import { useDetailsStore } from './useDetails';

export function useRowPatch() {
  const qc = useQueryClient();
  const store = useDetailsStore();
  return useCallback(
    (base: string, row: Row | undefined) => {
      if (!row) return;
      store.put(base, row);
      qc.setQueriesData<ComparePayload>({ queryKey: ['compare', 'runs'] }, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          runs: prev.runs.map((r) =>
            (r.run.file_path || r.run.run_id) !== base
              ? r
              : {
                  ...r,
                  snapshot: {
                    ...r.snapshot,
                    rows: r.snapshot.rows.map((x) =>
                      x.item_id === row.item_id ? { ...x, ...row, compare_item_id: x.compare_item_id } : x,
                    ),
                  },
                },
          ),
        };
      });
    },
    [qc, store],
  );
}
