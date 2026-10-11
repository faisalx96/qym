import { useLocation, useParams } from 'react-router-dom';
import { EmptyState, Icon, KeyValueGrid, Stack, Tag } from '@/ui';
import { constrained } from '@/features/shell/layout';

export interface ComingSoonProps {
  /** Area brief that owns this route, e.g. "03-overview-runs-list-charts". */
  brief: string;
  title: string;
}

/** Placeholder for routes an area agent will replace. Keeps deep links resolving. */
export function ComingSoon({ brief, title }: ComingSoonProps) {
  const location = useLocation();
  const params = useParams();
  return (
    <div className={constrained}>
      <EmptyState
        icon={<Icon name="flask" />}
        title={`${title} — coming soon`}
        body={
          <Stack gap="sm" align="center">
            <span>
              This page is being rebuilt by the <Tag kind="data">{brief}</Tag> area agent. The legacy page
              still works at the same path without <Tag kind="data">/app</Tag>.
            </span>
          </Stack>
        }
      />
      <KeyValueGrid
        aria-label="Route details"
        columns={2}
        dense
        items={[
          { key: 'path', label: 'Path', value: location.pathname + location.search, mono: true },
          { key: 'params', label: 'Params', value: JSON.stringify(params), mono: true },
        ]}
      />
    </div>
  );
}
