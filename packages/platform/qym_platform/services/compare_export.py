"""The "Comparison" tab of the compare HTML export.

A server-side port of what the Compare page computes (frontend/src/features/compare/lib:
``baseline.ts``, ``stats.ts``, ``tdist.ts``): per-run averages, paired deltas against the
baseline (first run) with a 95% Student-t band and p-value, the winner / stat strip, and the
aligned item-level diff. Pure functions over the run payloads the export already holds.
"""

from __future__ import annotations

import html as html_lib
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

_LANCZOS = (
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
)


def _beta_cf(a: float, b: float, x: float) -> float:
    tiny = 1e-30
    c = 1.0
    d = 1 - (a + b) * x / (a + 1)
    d = tiny if abs(d) < tiny else d
    d = 1 / d
    h = d
    for m in range(1, 201):
        m2 = 2 * m
        aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2))
        d = 1 + aa * d
        d = tiny if abs(d) < tiny else d
        c = 1 + aa / c
        c = tiny if abs(c) < tiny else c
        d = 1 / d
        h *= d * c
        aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1))
        d = 1 + aa * d
        d = tiny if abs(d) < tiny else d
        c = 1 + aa / c
        c = tiny if abs(c) < tiny else c
        d = 1 / d
        delta = d * c
        h *= delta
        if abs(delta - 1) < 3e-14:
            break
    return h


def _incomplete_beta(a: float, b: float, x: float) -> float:
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(
        math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log(1 - x)
    )
    if x < (a + 1) / (a + b + 2):
        return front * _beta_cf(a, b, x) / a
    return 1 - front * _beta_cf(b, a, 1 - x) / b


def t_two_sided_p(t: float, df: int) -> float:
    """P(|T| >= |t|) with ``df`` degrees of freedom."""
    if not math.isfinite(t):
        return 0.0
    return _incomplete_beta(df / 2, 0.5, df / (df + t * t))


def t_critical(df: int, confidence: float = 0.95) -> float:
    alpha = 1 - confidence
    lo, hi = 0.0, 1.0
    while t_two_sided_p(hi, df) > alpha and hi < 1e6:
        hi *= 2
    for _ in range(80):
        mid = (lo + hi) / 2
        if t_two_sided_p(mid, df) > alpha:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


# ---------------------------------------------------------------- scoring

def _direction(spec: Any) -> Optional[str]:
    if not isinstance(spec, dict):
        return None
    direction = str(spec.get("direction") or "").strip().lower()
    if direction == "minimize":
        return "minimize"
    if direction != "maximize":
        return None
    try:
        version = int(spec.get("schema_version") or 1)
    except (TypeError, ValueError):
        version = 1
    return None if spec.get("score_type") == "legacy" and version < 2 else "maximize"


def _score_value(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _is_error_meta(meta: Any) -> bool:
    return isinstance(meta, dict) and str(meta.get("status") or "").strip().lower() in {
        "error",
        "failed",
        "timeout",
    }


def _is_task_error(row: Dict[str, Any]) -> bool:
    status = str(row.get("status") or "").lower()
    return status in {"error", "failed"} or bool(row.get("task_error"))


def row_error(row: Dict[str, Any], metric: Optional[str] = None) -> bool:
    """A task error, or a raised scorer (for ``metric``, else any)."""
    if _is_task_error(row):
        return True
    meta = row.get("metric_meta") or {}
    names = [metric] if metric else list(meta)
    return any(_is_error_meta(meta.get(name)) for name in names)


def row_score(
    row: Optional[Dict[str, Any]], index: Optional[int], metric: str, direction: Optional[str]
) -> Tuple[Optional[float], bool]:
    """(score, is_error): errors count as 0, except on lower-is-better metrics, which leave them out."""
    if not row or index is None or str(row.get("status") or "").lower() == "not_received":
        return None, False
    left_out = direction == "minimize"
    if _is_task_error(row):
        return (None if left_out else 0.0), True
    meta = (row.get("metric_meta") or {}).get(metric)
    values = row.get("metric_values") or []
    raw = values[index] if index < len(values) else None
    if isinstance(meta, dict) and str(meta.get("item_edit") or "").lower() == "true":
        return _score_value(raw), False
    errored = _is_error_meta(meta)
    if errored and left_out:
        return None, True
    score = _score_value(raw)
    if score is None:
        return (0.0, True) if errored else (None, False)
    return score, errored


def _passes(score: Optional[float], threshold: float, direction: Optional[str], boolean: bool) -> Optional[bool]:
    if direction not in ("maximize", "minimize") or score is None:
        return None
    if boolean:
        return score <= 0.0001 if direction == "minimize" else score >= 0.9999
    return score <= threshold if direction == "minimize" else score >= threshold


def _verdict(delta: float, noise: float, direction: Optional[str]) -> str:
    if not math.isfinite(delta) or abs(delta) <= max(0.0, noise or 0.0):
        return "within_noise"
    if direction == "maximize":
        return "improved" if delta > 0 else "regressed"
    if direction == "minimize":
        return "improved" if delta < 0 else "regressed"
    return "changed"


# ---------------------------------------------------------------- model

def _rows(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list((payload.get("snapshot") or {}).get("rows") or [])


def _metric_names(payload: Dict[str, Any]) -> List[str]:
    snap = payload.get("snapshot") or {}
    run = payload.get("run") or {}
    return list(snap.get("metric_names") or run.get("metric_names") or [])


def _item_key(row: Dict[str, Any]) -> str:
    return str(row.get("compare_item_id") or row.get("item_id") or "")


def run_label(payload: Dict[str, Any], index: int) -> str:
    run = payload.get("run") or {}
    return str(run.get("run_name") or run.get("run_id") or f"run {index + 1}")


def run_letter(index: int) -> str:
    return chr(ord("A") + index) if index < 26 else str(index + 1)


def build_comparison(payloads: Sequence[Dict[str, Any]], metric: Optional[str] = None) -> Dict[str, Any]:
    """Everything the Comparison tab shows, as plain data (also what the tests assert on)."""
    runs = []
    for index, payload in enumerate(payloads):
        run = payload.get("run") or {}
        rows = {_item_key(r): r for r in _rows(payload) if _item_key(r)}
        names = _metric_names(payload)
        runs.append(
            {
                "letter": run_letter(index),
                "label": run_label(payload, index),
                "run": run,
                "rows": rows,
                "total": ((payload.get("snapshot") or {}).get("stats") or {}).get("total") or len(rows),
                "metrics": {name: i for i, name in enumerate(names)},
                "specs": run.get("metric_specs") or (payload.get("snapshot") or {}).get("metric_specs") or {},
            }
        )
    metrics: List[str] = []
    for r in runs:
        for name in r["metrics"]:
            if name not in metrics:
                metrics.append(name)
    primary = next((m for m in metrics if any((r["specs"].get(m) or {}).get("primary") is True for r in runs)), None)
    chosen = metric if metric in metrics else (primary or (metrics[0] if metrics else None))
    item_ids: List[str] = []
    seen = set()
    for r in runs:
        for key in r["rows"]:
            if key not in seen:
                seen.add(key)
                item_ids.append(key)

    def spec_of(name: str) -> Dict[str, Any]:
        for r in runs:
            if isinstance(r["specs"].get(name), dict):
                return r["specs"][name]
        return {}

    directions = {m: _direction(spec_of(m)) for m in metrics}

    def scores_for(r: Dict[str, Any], name: str) -> Dict[str, float]:
        out: Dict[str, float] = {}
        for key, row in r["rows"].items():
            score, _ = row_score(row, r["metrics"].get(name), name, directions[name])
            if score is not None:
                out[key] = score
        return out

    per_metric: Dict[str, List[Dict[str, Any]]] = {}
    for name in metrics:
        base_scores = scores_for(runs[0], name) if runs else {}
        cols = []
        for i, r in enumerate(runs):
            own = scores_for(r, name)
            mean = sum(own.values()) / len(own) if own else None
            cell: Dict[str, Any] = {"mean": mean, "n": len(own), "delta": None}
            if i > 0:
                diffs = [own[k] - base_scores[k] for k in own if k in base_scores]
                counts = {"improved": 0, "regressed": 0, "same": 0}
                for d in diffs:
                    if abs(d) <= 1e-9:
                        counts["same"] += 1
                    elif (d < 0) == (directions[name] == "minimize"):
                        counts["improved"] += 1
                    else:
                        counts["regressed"] += 1
                n = len(diffs)
                dmean = sum(diffs) / n if n else None
                half: Optional[float] = None
                p: Optional[float] = None
                if n >= 2 and dmean is not None:
                    var = sum((d - dmean) ** 2 for d in diffs) / (n - 1)
                    se = math.sqrt(var / n)
                    half = t_critical(n - 1) * se
                    p = t_two_sided_p(dmean / se, n - 1) if se > 0 else (1.0 if dmean == 0 else 0.0)
                cell["delta"] = {
                    "paired": n,
                    "mean": dmean,
                    "half_width": half,
                    "p": p,
                    "counts": counts,
                    "verdict": _verdict(dmean, half or 0.0, directions[name]) if dmean is not None and half is not None else None,
                }
            cols.append(cell)
        per_metric[name] = cols

    latency = []
    errors = []
    for r in runs:
        lats = [row.get("latency_ms") for row in r["rows"].values() if row.get("latency_ms") and row.get("status") == "completed"]
        latency.append(sum(lats) / len(lats) if lats else None)
        errors.append(sum(1 for row in r["rows"].values() if row_error(row)))

    strip = None
    diff_rows: List[Dict[str, Any]] = []
    if chosen is not None:
        direction = directions[chosen]
        spec = spec_of(chosen)
        all_scores = [s for r in runs for s in scores_for(r, chosen).values()]
        boolean = bool(all_scores) and all(s in (0.0, 1.0) for s in all_scores) or spec.get("score_type") == "boolean"
        try:
            threshold = float(spec["pass_threshold"]) if spec.get("pass_threshold") is not None else (0.2 if direction == "minimize" else 0.8)
        except (TypeError, ValueError):
            threshold = 0.2 if direction == "minimize" else 0.8
        wins = [0] * len(runs)
        ties = 0
        pass_at_k = 0
        pass_hat_k = 0
        total = 0
        for key in item_ids:
            scores = [
                row_score(r["rows"].get(key), r["metrics"].get(chosen), chosen, direction)[0] for r in runs
            ]
            verdicts = [_passes(s, threshold, direction, boolean) for s in scores]
            judged = [v for v in verdicts if v is not None]
            correct = sum(1 for v in judged if v)
            total += 1
            if correct > 0:
                pass_at_k += 1
            valid = [s for s in scores if s is not None]
            winner: Any = None
            if len(valid) >= 2 and direction:
                best = max(valid) if direction == "maximize" else min(valid)
                idxs = [i for i, s in enumerate(scores) if s == best]
                if max(valid) == min(valid) or len(idxs) != 1:
                    ties += 1
                    winner = "tie"
                else:
                    wins[idxs[0]] += 1
                    winner = idxs[0]
                if judged and correct == len(judged):
                    pass_hat_k += 1
            elif judged and correct == len(judged) and len(valid) >= 2:
                pass_hat_k += 1
            base = scores[0]
            moves = []
            for i, s in enumerate(scores):
                if i == 0 or s is None or base is None or abs(s - base) <= 1e-9:
                    moves.append("same")
                else:
                    moves.append("improved" if ((s < base) == (direction == "minimize")) else "regressed")
            first = next((r["rows"][key] for r in runs if key in r["rows"]), {})
            diff_rows.append(
                {
                    "item": key,
                    "preview": str(first.get("input_preview") or first.get("input") or key),
                    "scores": scores,
                    "verdicts": verdicts,
                    "moves": moves,
                    "winner": winner,
                    "errors": [
                        bool(r["rows"].get(key)) and row_error(r["rows"][key], chosen) for r in runs
                    ],
                }
            )
        strip = {
            "metric": chosen,
            "direction": direction,
            "threshold": threshold,
            "boolean": boolean,
            "items": total,
            "wins": wins,
            "ties": ties,
            "pass_at_k": pass_at_k / total if total else 0.0,
            "pass_hat_k": pass_hat_k / total if total else 0.0,
        }
    return {
        "runs": runs,
        "metrics": metrics,
        "directions": directions,
        "per_metric": per_metric,
        "latency": latency,
        "errors": errors,
        "chosen": chosen,
        "strip": strip,
        "items": diff_rows,
        "item_count": len(item_ids),
    }


# ---------------------------------------------------------------- rendering

def _fmt_score(value: Optional[float], boolean: bool = False) -> str:
    if value is None:
        return "—"
    if value > 1 or value < 0:
        return f"{value:.1f}" if abs(value) >= 1 else f"{value:.3f}"
    return f"{value * 100:.1f}%"


def _fmt_delta(value: float, numeric: bool) -> str:
    sign = "+" if value > 0 else "−" if value < 0 else ""
    mag = abs(value)
    if numeric:
        return f"{sign}{mag:.3f}" if mag < 1 else f"{sign}{mag:.1f}"
    return f"{sign}{mag * 100:.1f} pts"


def _fmt_latency(ms: Optional[float]) -> str:
    if not ms or ms <= 0:
        return "—"
    if ms >= 60000:
        total = round(ms / 1000)
        return f"{total // 60}m {total % 60}s" if total % 60 else f"{total // 60}m"
    if ms >= 1000:
        return f"{ms / 1000:.1f}s"
    return f"{ms:.0f}ms"


_GLYPH = {"improved": "▲", "regressed": "▼", "within_noise": "≈", "changed": "Δ"}
_WORD = {"improved": "improved", "regressed": "regressed", "within_noise": "within noise", "changed": "changed"}


def render_comparison_html(cmp: Dict[str, Any], max_items: int = 2000) -> str:
    """The Comparison tab body: run summary, baseline table, winner / stat strip, item diff."""
    esc = html_lib.escape
    runs = cmp["runs"]
    out: List[str] = ['<section class="cmp" aria-label="Comparison">']

    # run summary
    out.append('<h2>Runs</h2><table class="summary"><thead><tr>')
    for head in ("Run", "Name", "Status", "Owner", "Dataset", "Model", "Items", "Errors", "Runtime", "Experiment"):
        out.append(f"<th>{head}</th>")
    out.append("</tr></thead><tbody>")
    for i, r in enumerate(runs):
        run = r["run"]
        status = run.get("status")
        status = str(getattr(status, "value", status) or "")
        status = status.split(".")[-1].upper() if status else "-"
        owner = run.get("owner") or {}
        owner_name = owner.get("display_name") or owner.get("email") or ""
        dataset = " ".join(str(x) for x in (run.get("dataset_name"), f"v{run['dataset_version']}" if run.get("dataset_version") else "") if x)
        experiment = (run.get("experiment") or {}).get("name") or ""
        errors = (run.get("error_count") or 0) + (run.get("execution_error_count") or 0)
        cells = [
            r["letter"],
            r["label"],
            status,
            owner_name or "-",
            dataset or "-",
            run.get("model_name") or "-",
            r["total"],
            errors if run.get("error_count") is not None or run.get("execution_error_count") is not None else cmp["errors"][i],
            _fmt_latency(run.get("duration_ms")),
            experiment or "-",
        ]
        out.append("<tr>" + "".join(f"<td>{esc(str(c))}</td>" for c in cells) + "</tr>")
    out.append("</tbody></table>")

    # per-run averages
    out.append('<h2>Per-run averages</h2><p class="muted">Baseline is the first run; change is the paired difference with its 95% noise band (Student t).</p>')
    out.append('<table class="metrics"><thead><tr><th>Run</th>')
    for m in cmp["metrics"]:
        out.append(f"<th>{esc(m)}</th>")
    out.append("<th>Latency</th><th>Errors</th></tr></thead><tbody>")
    for i, r in enumerate(runs):
        out.append(f"<tr><th scope=\"row\">{esc(r['letter'])} · {esc(r['label'])}{' (baseline)' if i == 0 else ''}</th>")
        for m in cmp["metrics"]:
            cell = cmp["per_metric"][m][i]
            numeric = cell["mean"] is not None and (cell["mean"] > 1 or cell["mean"] < 0)
            text = esc(_fmt_score(cell["mean"]))
            d = cell["delta"]
            if d and d["mean"] is not None:
                verdict = d["verdict"] or "within_noise"
                band = f" ±{(d['half_width'] * 100):.1f}" if d["half_width"] is not None and not numeric else (f" ±{d['half_width']:.3f}" if d["half_width"] is not None else "")
                p = f", p={d['p']:.3f}" if d["p"] is not None else ""
                c = d["counts"]
                text += (
                    f' <span class="delta" data-verdict="{verdict}">{_GLYPH[verdict]} {esc(_fmt_delta(d["mean"], numeric))}'
                    f' <span class="muted">({_WORD[verdict]}{esc(band)}{esc(p)})</span></span>'
                    f' <span class="muted">{c["improved"]} better · {c["regressed"]} worse · {c["same"]} same</span>'
                )
            elif i == 0:
                text += ' <span class="muted">baseline</span>'
            out.append(f"<td>{text}</td>")
        out.append(f"<td>{esc(_fmt_latency(cmp['latency'][i]))}</td><td>{cmp['errors'][i]}</td></tr>")
    out.append("</tbody></table>")

    # winner / stat strip
    strip = cmp["strip"]
    if strip:
        out.append(f'<h2>Winner strip · {esc(strip["metric"])}</h2><ul class="strip">')
        out.append(f'<li><b>{strip["items"]}</b> items compared</li>')
        if strip["direction"]:
            for i, r in enumerate(runs):
                out.append(f'<li>{esc(r["letter"])} wins <b>{strip["wins"][i]}</b></li>')
            out.append(f'<li>Ties <b>{strip["ties"]}</b></li>')
            out.append(f'<li>Pass@{len(runs)} <b>{strip["pass_at_k"] * 100:.1f}%</b></li>')
            out.append(f'<li>Pass^{len(runs)} <b>{strip["pass_hat_k"] * 100:.1f}%</b></li>')
        else:
            out.append('<li class="muted">No direction declared for this metric: no winners.</li>')
        out.append("</ul>")

        # item-level diff
        shown = cmp["items"][:max_items]
        out.append(f'<h2>Items · {esc(strip["metric"])}</h2>')
        if len(cmp["items"]) > len(shown):
            out.append(f'<p class="muted">First {len(shown)} of {len(cmp["items"])} items.</p>')
        out.append('<table class="items"><thead><tr><th>#</th><th>Input</th>')
        for r in runs:
            out.append(f"<th>{esc(r['letter'])}</th>")
        out.append("</tr></thead><tbody>")
        for n, it in enumerate(shown, 1):
            out.append(f'<tr data-item="{esc(it["item"], quote=True)}"><td>{n}</td><td class="preview">{esc(it["preview"][:140])}</td>')
            for i in range(len(runs)):
                s = it["scores"][i]
                verdict = it["verdicts"][i]
                state = "error" if it["errors"][i] else ("pass" if verdict is True else "fail" if verdict is False else "none")
                word = {"pass": "Pass", "fail": "Fail", "error": "Error", "none": "No score"}[state]
                move = it["moves"][i]
                arrow = " ▲" if move == "improved" else " ▼" if move == "regressed" else ""
                win = " ★" if it["winner"] == i else ""
                out.append(f'<td class="pill" data-state="{state}">{esc(_fmt_score(s) if s is not None else word)} {esc(word)}{arrow}{win}</td>')
            out.append("</tr>")
        out.append("</tbody></table>")
    out.append("</section>")
    return "".join(out)
