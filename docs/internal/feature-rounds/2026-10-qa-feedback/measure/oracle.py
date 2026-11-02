"""Reference oracle for the list-filter criteria (QA1): reads support-faq v1 through the public API and computes, in Python,
the facets the new endpoint must return and the match counts for any / all. usage: oracle.py [base-url]"""
import json, sys, urllib.request
from collections import Counter
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8981"
def get(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.load(r)
items = get("/v1/datasets/support-faq/versions/v1/items?project_slug=access-demo&limit=1000")["items"]
print("items", len(items))
def text(v):
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return json.dumps(v)
    if isinstance(v, str) and len(v) <= 500: return v
    return None
def walk(node, prefix, out):
    for k, v in node.items():
        path = prefix + (k,)
        if isinstance(v, dict):
            if len(path) < 3: walk(v, path, out)
        elif isinstance(v, list):
            elems = {text(e) for e in v[:200] if not isinstance(e, (dict, list)) and text(e) is not None}
            if elems: out.setdefault(".".join(path), {"list": set(), "scalar": set()})["list"] |= elems
        else:
            t = text(v)
            if t is not None: out.setdefault(".".join(path), {"list": set(), "scalar": set()})["scalar"].add(t)
facets, per_item = {}, []
for it in items:
    found = {}
    walk(it["metadata"], (), found)
    per_item.append(found)
    for p, d in found.items():
        f = facets.setdefault(p, {"has_list": False, "has_scalar": False, "counts": Counter()})
        f["has_list"] |= bool(d["list"]); f["has_scalar"] |= bool(d["scalar"])
        for v in d["list"] | d["scalar"]: f["counts"][v] += 1
for p in sorted(facets):
    f = facets[p]; kind = "mixed" if f["has_list"] and f["has_scalar"] else "list" if f["has_list"] else "scalar"
    print(f"{p:20s} {kind:7s} values={len(f['counts'])} top={f['counts'].most_common(4)}")
def has(found, path, v): d = found.get(path); return bool(d) and v in (d["list"] | d["scalar"])
def match(path, vals, mode):
    fn = any if mode == "any" else all
    return sum(fn(has(f, path, v) for v in vals) for f in per_item)
for path, vals in [("tags", ["billing", "refund"]), ("tags", ["billing", "fraud"]), ("channels", ["chat", "phone"]), ("source.labels", ["gold", "reviewed"]), ("levels", ["0", "2"])]:
    print(f"{path} {vals}: partial(any)={match(path, vals, 'any')} full(all)={match(path, vals, 'all')}")
