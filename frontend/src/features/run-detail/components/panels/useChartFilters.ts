/** Chart clicks write into the one filter model (view + page filters). */
import { useMemo } from 'react';
import { useRunPage } from '../../RunContext';
import type { BoolSegment, ScoreBucket } from '../../lib/overviewModel';

export function useChartFilters() {
  const { api, model } = useRunPage();
  const { view } = api;
  return useMemo(() => {
    const metricPatch = (metric: string) => ({
      metric: metric === model.defaultMetric ? null : metric,
      threshold: metric === api.selectedMetric ? view.threshold : null,
    });
    return {
      pickBucket(metric: string, b: ScoreBucket) {
        api.replaceView({
          ...view,
          ...metricPatch(metric),
          show: 'all',
          page: 1,
          filters: { ...view.filters, score: { min: b.min, max: b.max }, repeat: null },
        });
      },
      pickSegment(metric: string, seg: BoolSegment) {
        if (seg.key !== 'passed' && seg.key !== 'failed' && seg.key !== 'metric_errors') return;
        api.replaceView({
          ...view,
          ...metricPatch(metric),
          show: seg.key,
          page: 1,
          filters: { ...view.filters, score: null, repeat: null },
        });
      },
    };
  }, [api, model.defaultMetric, view]);
}
