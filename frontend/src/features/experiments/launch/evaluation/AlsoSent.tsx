import { Button } from '@/ui';
import { Callout } from '../components/Callout';
import { useLaunch } from '../LaunchContext';
import { alsoSent, pointerToFieldName, removeAlsoSent } from '../model';
import styles from './evaluation.module.css';

/** Evaluator keys from the starting point or Raw JSON that no field shows (report_k, dataset_version). */
export function AlsoSent() {
  const { doc, setDoc, registerField } = useLaunch();
  const items = alsoSent(doc);
  if (!items.length) return null;
  return (
    <div ref={(el) => registerField(pointerToFieldName('/evaluator/report_k'), el)} data-also-sent>
      <Callout title="Also sent">
        <p className={styles.hint}>From the starting point or Raw JSON; they have no field here.</p>
        {items.map((item) => (
          <div key={item.key} className={styles.row}>
            <span className={styles.mono}>
              {item.key} = {JSON.stringify(item.value)}
            </span>
            <Button
              variant="ghost"
              aria-label={`Stop sending ${item.key}`}
              onPress={() => setDoc((d) => removeAlsoSent(d, item.key as 'report_k' | 'dataset_version'))}
            >
              Remove
            </Button>
          </div>
        ))}
      </Callout>
    </div>
  );
}
