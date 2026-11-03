import { useLiveSources, type LiveSourceInfo } from '@/api/live';
import { useSearchParamsState } from '@/lib/url-state';
import { Select, Tag } from '@/ui';
import styles from '../live.module.css';

/** The source and environment have the same page-level control on both live pages. */
export function SourceControl({
  slug,
  source,
  status,
}: {
  slug: string;
  source: string;
  status?: LiveSourceInfo;
}) {
  const { data } = useLiveSources(slug);
  const { replaceUrlQuery } = useSearchParamsState();
  const sources = data?.sources ?? [];
  const current = sources.find((item) => item.key === source || item.id === source) ?? status;
  return (
    <span
      className={styles.source}
      data-live-block="source"
      data-multiple={sources.length > 1 ? 'true' : undefined}
    >
      {sources.length > 1 ? (
        <Select
          label="Live source"
          wrapValue
          hideLabel
          items={sources.map((item) => ({ key: item.key, label: item.name }))}
          value={current?.key ?? source}
          onChange={(key) => {
            if (key !== null) replaceUrlQuery({ source: String(key), page: null, days_page: null });
          }}
          renderItem={(item) => <span dir="auto">{item.label}</span>}
          renderValue={(item) => <span dir="auto">{item.label}</span>}
        />
      ) : (
        <Tag kind="data" dir="auto">
          {current?.name ?? source}
        </Tag>
      )}
      {current?.environment ? (
        <Tag kind="data" dir="auto">
          {current.environment}
        </Tag>
      ) : null}
    </span>
  );
}
