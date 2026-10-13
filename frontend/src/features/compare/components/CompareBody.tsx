/** Compare report body: scope strip, stacked sections and the quick-filter sidebar that exists only while a scope is active. */
import { useState } from 'react';
import { useMediaQuery } from '@/features/shell';
import { useSidebarHidden } from '@/lib/useSidebarHidden';
import { ReportLayout, ScopeBar } from '@/ui';
import { useScope } from '../hooks/useScope';
import { QuickFilters } from './QuickFilters';
import { CompareReport, scrollToSection } from './ReportSections';

export const WIDE_QUERY = '(min-width: 1200px)';

export function CompareBody() {
  const scope = useScope();
  const wide = useMediaQuery(WIDE_QUERY);
  const [hidden, setHidden] = useSidebarHidden();
  const [drawer, setDrawer] = useState(false);
  const viewItems = () => {
    setDrawer(false);
    scrollToSection('items');
  };
  return (
    <ReportLayout
      wide={wide}
      sidebarOpen={scope.active && !hidden}
      drawerOpen={drawer && scope.active}
      onDrawerOpenChange={setDrawer}
      sidebar={
        scope.active ? (
          <QuickFilters onHide={wide ? () => setHidden(true) : undefined} onViewItems={viewItems} />
        ) : undefined
      }
    >
      {scope.active ? (
        <ScopeBar
          shown={scope.shown}
          total={scope.total}
          chips={scope.chips.map((chip) => ({
            key: chip.key,
            label: chip.label,
            onClear: () => scope.clearChip(chip),
          }))}
          onClearAll={scope.clearAll}
          onJumpToItems={viewItems}
          sidebarOpen={wide ? !hidden : drawer}
          narrow={!wide}
          hideChips={wide && !hidden}
          onToggleSidebar={() => (wide ? setHidden(!hidden) : setDrawer(true))}
        />
      ) : null}
      <CompareReport />
    </ReportLayout>
  );
}
