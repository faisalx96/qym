/**
 * The one sticky element of the page: the section links, then the page-level controls on the right (K6, C154):
 * Metric, the Pass if slider, Filters and one red Clear. No section repeats them.
 */
import { Button, Icon, Slider, Tag } from '@/ui';
import { useCompare } from '../CompareContext';
import { clearedView } from '../lib/activeChips';
import { activeFilterCount } from '../lib/filters';
import { useItemsUi } from './items/ItemsUi';
import { ReportNav } from './ReportSections';
import { MetricTabs } from './SelectionBar';
import { scrollToSection } from './sectionIds';
import styles from './CompareBar.module.css';

export function CompareBar() {
  return (
    <div className={styles.bar} data-compare-sticky="" data-part="section-nav">
      <ReportNav />
      <PageControls />
    </div>
  );
}

function PageControls() {
  const { model, metric, ctx, c, defs } = useCompare();
  const { filtersOpen, setFiltersOpen } = useItemsUi();
  const type = model.types[metric] ?? 'score';
  const dir = ctx.direction;
  const count = activeFilterCount(c.view, defs);
  const clearCount = count + (c.view.q ? 1 : 0);
  return (
    <div className={styles.controls} data-part="page-controls">
      <MetricTabs compact />
      {type === 'boolean' || type === 'numeric' || !dir ? null : (
        <Slider
          key={`${metric}:${ctx.threshold}`}
          label={dir === 'minimize' ? 'Pass if ≤' : 'Pass if ≥'}
          unit="%"
          minValue={5}
          maxValue={100}
          step={5}
          width="10rem"
          defaultValue={Math.round(ctx.threshold * 100)}
          onChangeEnd={(v) => c.setThreshold(metric, v / 100)}
        />
      )}
      {model.alignment.status === 'aligned' ? (
        <Button
          size="sm"
          variant="neutral"
          icon={<Icon name="list" size={14} />}
          aria-expanded={filtersOpen}
          data-part="items-filters-btn"
          onPress={() => {
            setFiltersOpen(!filtersOpen);
            if (!filtersOpen) scrollToSection('items');
          }}
        >
          Filters
          {/* C217: no zero count at rest */}
          {count ? <Tag kind="count">{count}</Tag> : null}
        </Button>
      ) : null}
      {clearCount ? (
        // Clear stays red, with its count on a red disc (owner, Nov 1)
        <Button
          size="sm"
          variant="danger"
          icon={<Icon name="close" size={12} />}
          data-part="items-clear-btn"
          onPress={() => c.setView(clearedView())}
        >
          Clear <span className={styles.clearCount}>{clearCount}</span>
        </Button>
      ) : null}
    </div>
  );
}
