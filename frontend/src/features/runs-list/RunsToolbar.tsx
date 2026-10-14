/** Runs and Charts command bar: search, Time / Origin, facet triggers, chips (see FilterBar). */
import type { ReactNode, Ref } from 'react';
import type { Facets } from '@/api/dashboardTypes';
import { useFilterBarParts } from './FilterBar';
import type { ViewPatch } from './useRunsView';
import type { RunsView } from './urlState';
import styles from './RunsPage.module.css';

export function RunsToolbar({
  mode,
  view,
  facets,
  owners,
  onChange,
  searchRef,
  end,
}: {
  mode: 'runs' | 'charts';
  view: RunsView;
  facets: Facets | undefined;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
  searchRef?: Ref<HTMLInputElement>;
  end?: ReactNode;
}) {
  const parts = useFilterBarParts({ view, facets, owners, onChange, searchRef, showSearch: mode === 'runs' });
  return (
    <div
      className={styles.commandBar}
      role="toolbar"
      aria-label={`${mode === 'runs' ? 'Runs' : 'Charts'} toolbar`}
    >
      <div className={styles.barMain}>
        {parts.search}
        {parts.filters}
      </div>
      {end ? <div className={styles.barEnd}>{end}</div> : null}
      <div className={styles.barRows}>{parts.rows}</div>
    </div>
  );
}

/** The runs toolbar pieces for DataTable.Toolbar: search, Time / Origin, and the facet and chip rows. */
export function useRunsToolbarParts(args: {
  view: RunsView;
  facets: Facets | undefined;
  owners: Record<string, string>;
  onChange: (patch: ViewPatch) => void;
  searchRef?: Ref<HTMLInputElement>;
}) {
  return useFilterBarParts(args);
}
