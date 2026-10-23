import json, time, urllib.request, urllib.error, sys
BASE = "http://127.0.0.1:9010"
HDR = {}
def call(method, path, body=None, accept="application/json", headers=None, base=None, raw=False):
    h = {"Content-Type": "application/json", "Accept": accept, **HDR, **(headers or {})}
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request((base or BASE) + path, data=data, method=method, headers=h)
    try:
        r = urllib.request.urlopen(req, timeout=120); code, rh, b = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        code, rh, b = e.code, dict(e.headers), e.read()
    if raw: return code, rh, b
    t = b.decode("utf-8", "replace")
    try: return code, json.loads(t)
    except Exception: return code, t
def parse_sse(t):
    ev = []
    for blk in t.split("\n\n"):
        e = d = None
        for ln in blk.splitlines():
            if ln.startswith("event: "): e = ln[7:]
            elif ln.startswith("data: "): d = json.loads(ln[6:])
        if e: ev.append((e, d))
    return ev
def stream(path, body=None, base=None):
    t0=time.time()
    code, rh, b = call("POST", path, body, accept="text/event-stream", raw=True, base=base)
    t = b.decode()
    if code != 200: return code, json.loads(t) if t[:1]=="{" else t, 0
    return code, parse_sse(t), time.time()-t0
def configure(script, key=__import__("os").environ.get("REVIEW_KEY","dummy-key"), base=None):
    return call("PUT", "/v1/admin/feedback-agent", {"llm_base_url": "http://127.0.0.1:10010/v1", "llm_model": f"feedback:{script}", "llm_api_key": key}, base=base)
def show(ev):
    out=[]
    for e,d in ev:
        if e=="delta": continue
        out.append((e, {k:(v if k not in ("proposal","items") else "...") for k,v in (d or {}).items()}))
    txt="".join(d["text"] for e,d in ev if e=="delta")
    return out, txt
