import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SegmentedControl, Tag } from '@/ui';
import styles from './MockFrame.module.css';

export type MockView = 'dataset' | 'item' | 'reviews' | 'trash';

const VIEWS: { value: MockView; label: string }[] = [
  { value: 'dataset', label: 'Dataset' },
  { value: 'item', label: 'Item editor' },
  { value: 'reviews', label: 'Reviews' },
  { value: 'trash', label: 'Trash' },
];

export function useMockView(): [MockView, (v: MockView) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const view = (VIEWS.some((v) => v.value === raw) ? raw : 'dataset') as MockView;
  return [
    view,
    (v) => {
      const next = new URLSearchParams(params);
      next.set('view', v);
      setParams(next, { replace: true });
    },
  ];
}

export interface MockFrameProps {
  variant: string;
  crumbs: ReactNode[];
  note?: ReactNode;
  children: ReactNode;
}

/** Fake shell chrome: breadcrumb topbar + the in-mock view switcher. The content region is what is judged. */
export function MockFrame({ variant, crumbs, note, children }: MockFrameProps) {
  const [view, setView] = useMockView();
  return (
    <div className={styles.frame} data-mock-variant={variant}>
      <div className={styles.topbar}>
        <nav className={styles.crumbs} aria-label="Breadcrumbs">
          {crumbs.map((c, i) => (
            <span key={i} className={styles.crumbs}>
              {i > 0 ? (
                <span className={styles.crumbSep} aria-hidden="true">
                  /
                </span>
              ) : null}
              {i === crumbs.length - 1 ? <strong>{c}</strong> : c}
            </span>
          ))}
        </nav>
        <span className={styles.spacer} />
        <SegmentedControl label="Mock view" options={VIEWS} value={view} onChange={setView} />
        <span className={styles.variantTag}>
          mock <Tag kind="data">{variant}</Tag>
        </span>
      </div>
      {note ? <div className={styles.note}>{note}</div> : null}
      <div className={styles.main}>{children}</div>
    </div>
  );
}

/** `?ds=private` switches the dataset screen to the private test set (locked state for a non-admin). */
export function useMockDataset(): 'public' | 'private' {
  const [params] = useSearchParams();
  return params.get('ds') === 'private' ? 'private' : 'public';
}
