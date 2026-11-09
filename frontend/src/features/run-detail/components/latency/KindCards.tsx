/**
 * Trace stats by kind (legacy renderKinds): one card each for LLM, Tools (and Retrieval) and Eval, three large
 * numbers in the kind's colour. Each number opens its breakdown by call site, tool or evaluator.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Icon } from '@/ui';
import { FAMILY_LABEL, FAMILY_TONE, kindPanels, type Family, type LatencyData } from '../../lib/latencyModel';
import { FAMILY_ICON, Glyph } from './kinds';
import { cssVars } from './Tip';
import styles from './Traces.module.css';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const BY_WORD: Partial<Record<Family, string>> = { LLM: 'call site', TOOL: 'tool', EVAL: 'evaluator' };

export function KindCards({ D, onOpenSteps }: { D: LatencyData; onOpenSteps: (family: Family) => void }) {
  const panels = useMemo(() => kindPanels(D), [D]);
  const [open, setOpen] = useState<{ family: Family; key: string } | null>(null);
  const captured = panels.some((p) => p.family === 'LLM' || p.family === 'TOOL');
  if (!panels.length) return null;
  return (
    <div className={styles.kinds}>
      {panels.map((p) => {
        const tone = FAMILY_TONE[p.family];
        const count = p.rows.length;
        const openKey = open && open.family === p.family ? open.key : null;
        const stat = p.stats.find((s) => s.key === openKey);
        const rows = stat ? p.rows.map((g) => ({ g, v: stat.by(g) })).sort((a, b) => b.v - a.v) : [];
        const max = Math.max(0, ...rows.map((r) => r.v)) || 1;
        const shown = rows.slice(0, 7);
        return (
          <Card
            key={p.family}
            as="section"
            className={styles.kind}
            style={cssVars({ '--tone': tone })}
            aria-label={FAMILY_LABEL[p.family]}
          >
            <div className={styles.kindHead}>
              <Glyph icon={FAMILY_ICON[p.family]} tone={tone} />
              <span className={styles.kindName}>{FAMILY_LABEL[p.family]}</span>
              <span className={styles.kindMeta}>
                {count} {count === 1 ? p.unitWord.replace(/s$/, '') : p.unitWord}
              </span>
            </div>
            <div className={styles.kstats} style={cssVars({ '--n': p.stats.length })}>
              {p.stats.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={styles.kstat}
                  aria-expanded={openKey === s.key}
                  onClick={() => setOpen(openKey === s.key ? null : { family: p.family, key: s.key })}
                >
                  <span className={styles.kvalue}>
                    {s.value}
                    {s.unit ? <small>{s.unit}</small> : null}
                  </span>
                  <span className={styles.klabel}>
                    {s.label}
                    <Icon name="chevron-down" size={12} />
                  </span>
                </button>
              ))}
            </div>
            {stat ? (
              <div className={styles.breakdown}>
                <div className={styles.breakdownHead}>
                  <span>
                    <b>{stat.byTitle ?? `${cap(stat.label)} by ${BY_WORD[p.family] ?? 'step'}`}</b>
                    {rows.length > shown.length ? ` · top ${shown.length} of ${rows.length}` : ''}
                  </span>
                  <button type="button" className={styles.linkButton} onClick={() => onOpenSteps(p.family)}>
                    Open in Step timings <Icon name="chevron-right" size={12} />
                  </button>
                </div>
                {shown.map(({ g, v }, i) => (
                  <div key={i} className={styles.brow}>
                    <span className={styles.browName}>
                      {g.name}
                      {g.model && g.model !== g.name ? <small>{g.model}</small> : null}
                    </span>
                    <span className={styles.browBar} aria-hidden="true">
                      <i
                        style={cssVars({
                          '--w': (100 * v) / max,
                          ...(stat.bad ? { '--tone': 'var(--error)' } : {}),
                        })}
                      />
                    </span>
                    <span className={styles.browValue} data-bad={stat.bad && v > 0.04 ? '' : undefined}>
                      {stat.byFmt(v)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        );
      })}
      {!captured ? (
        <p className={styles.note}>
          LLM and tool spans were not captured for this run.{' '}
          <Link to="/docs/sdk-guide/results">How tracing works</Link>
        </p>
      ) : null}
    </div>
  );
}
