import { useState, type ComponentProps } from 'react';
import { downloadPerformanceFile } from '@/api/performance';
import { InlineNotice, LinkButton } from '@/ui';

/** A download keeps its normal link while adding the Performance read opt-in. */
export function PerformanceDownload(props: ComponentProps<typeof LinkButton>) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <LinkButton
        {...props}
        onClick={(event) => {
          event.preventDefault();
          if (!props.href || props.isDisabled) return;
          setFailed(false);
          void downloadPerformanceFile(props.href).catch(() => setFailed(true));
        }}
      />
      {failed ? <InlineNotice tone="danger">Couldn’t download the file. Try again.</InlineNotice> : null}
    </>
  );
}
