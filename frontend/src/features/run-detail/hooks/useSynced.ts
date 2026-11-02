/** A text input mirrored from external state (URL) that commits after a pause. */
import { useEffect, useRef, useState } from 'react';

export function useSyncedInput(external: string, commit: (value: string) => void, ms: number) {
  const [local, setLocal] = useState(external);
  const [seen, setSeen] = useState(external);
  if (seen !== external) {
    setSeen(external);
    setLocal(external);
  }
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  });
  useEffect(() => {
    if (local === external) return undefined;
    const t = setTimeout(() => commitRef.current(local), ms);
    return () => clearTimeout(t);
  }, [local, external, ms]);
  return [local, setLocal] as const;
}
