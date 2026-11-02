"""Live API checks part 2 (item state, batch, meta, compare, download) after review-a-api.py. usage: BASE"""
import json, sys, time, httpx
B = sys.argv[1]; P = {"project_slug": "pa"}
def H(u): return {"X-User-Email": f"{u}@x.com", "Origin": "http://localhost:8000"}
c = httpx.Client(base_url=B, timeout=60)
def chk(id_, ok, note=""): print(("PASS " if ok else "FAIL ") + id_, str(note)[:230])
U = "/v1/datasets/qa"; V1 = U+"/versions/v1"; V2 = U+"/versions/v2"
def g(u, who="mem2", **p): return c.get(u, params={**P, **p}, headers=H(who))
def po(u, body, who="mem2", **p): return c.post(u, params={**P, **p}, headers=H(who), json=body)
r = c.get(V1+"/items", params=P, headers=H("mem2")); j=r.json(); chk("view reads items v1", r.status_code==200 and j["total"]==30, j.get("counts"))
chk("A2-49 shape", j["items"][0]["state"]=="active" and j["items"][0]["disabled"] is None, list(j["items"][0]))
chk("A2-52 counts", j["counts"]=={"active":30,"disabled":0,"all":30}, j["counts"])
# published disable
r = po(V1+"/items/i0:disable", {"reason":"x"}); chk("A2-54 published 409", r.status_code==409 and r.json()["detail"]=="Create a draft to change item state", r.text)
r = po(V1+"/items/i0:enable", {}); chk("A2-55 published enable 409", r.status_code==409 and r.json()["detail"]=="Create a draft to change item state", r.text)
r = po(V2+"/items/zzz:disable", {}); chk("A2-54 unknown 404", r.status_code==404 and r.json()["detail"]=="Dataset item not found", r.text)
r = po(V2+"/items/i0:disable", {"reason":"x"*501}); chk("A2-54 reason 501", r.status_code==422 and r.json()["detail"]=="Reason must be 500 characters or fewer", r.text)
r = po(V2+"/items/i0:disable", {"reason":"too hard"}); j=r.json(); chk("A2-54 disable", r.status_code==200 and j["changed"] is True and j["item"]["state"]=="disabled" and j["item"]["disabled"]["reason"]=="too hard" and j["item"]["disabled"]["by"]["email"]=="mem2@x.com", j)
r = po(V2+"/items/i0:disable", {}); chk("A2-56 idempotent", r.status_code==200 and r.json()["changed"] is False)
r = g(V2+"/items/i0/../i0"); 
r = po(V2+"/items/i1:enable", {}); chk("A2-56 enable active noop", r.json()["changed"] is False)
revs = g("/api/datasets/qa/versions/v2/items/i0/revisions").json(); print("revisions", json.dumps(revs)[:400])
j = g(V2+"/items").json(); chk("A2-49 default active only", j["total"]==29 and j["counts"]=={"active":29,"disabled":1,"all":30}, (j["total"], j["counts"]))
for s,t in [("disabled",1),("all",30)]:
    j = g(V2+"/items", state=s).json(); chk("A2-50 state="+s, j["total"]==t, j["total"])
r = g(V2+"/items", state="bogus"); chk("A2-50 422", r.status_code==422 and r.json()["detail"]=="state must be active, disabled or all", r.text)
r = g(V2+"/items/i0"); chk("A2-51 item get any state", r.status_code==200 and r.json().get("state", r.json().get("item",{}).get("state"))=="disabled", r.text[:120])
vs = g(U+"/versions").json(); print("versions", [(v["version"], v["item_count"], v.get("disabled_count")) for v in (vs["versions"] if isinstance(vs,dict) else vs)])
d = g(U).json(); dd = d.get("dataset", d); print("latest", dd.get("latest_version",{}) and (dd["latest_version"].get("disabled_count")))
# download
r = g(V2+":download"); n=len([l for l in r.text.splitlines() if l.strip()]); r2 = g(V2+":download", include_disabled="true"); n2=len([l for l in r2.text.splitlines() if l.strip()]); chk("A2-61 download", (n,n2)==(29,30), (n,n2)); 
# meta
def cnt(**p): 
    r = g(V1+"/items", **p); return r
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","meta.domain:finance")], headers=H("mem2")); chk("A3-43 meta domain", r.json()["total"]==15, r.json()["total"])
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","meta.domain:finance"),("meta","meta.source.region:sa")], headers=H("mem2")); chk("A3-44 nested AND", r.json()["total"]==5, (r.json()["total"], r.json()["counts"]))
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","meta.difficulty:2")], headers=H("mem2")); chk("A3-43 number", r.json()["total"]==10, r.json()["total"])
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","meta.flag:true")], headers=H("mem2")); chk("A3-43 bool", r.json()["total"]==15, r.json()["total"])
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","meta.domain:finance")], headers=H("mem2")); 
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","meta.source.nope.x:sa")], headers=H("mem2")); chk("A3-44 missing path", r.status_code==200 and r.json()["total"]==0)
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","meta.domain.x:finance")], headers=H("mem2")); chk("A3-44 through non-object", r.status_code==200 and r.json()["total"]==0, r.text[:80])
for m,t in [("nocolon","meta must look like path:value"),("a.b.c.d:x","Metadata path must be dotted keys of at most 3 levels"),("a..b:x","Metadata path must be dotted keys of at most 3 levels"),("a b:x","Metadata path must be dotted keys of at most 3 levels")]:
    r = c.get(V1+"/items", params=[("project_slug","pa"),("meta",m)], headers=H("mem2")); chk("A3-45 "+m, r.status_code==422 and r.json()["detail"]==t, r.text[:120])
r = c.get(V1+"/items", params=[("project_slug","pa")]+[("meta",f"k{i}:v") for i in range(6)], headers=H("mem2")); chk("A3-45 6 filters", r.status_code==422 and r.json()["detail"]=="Use at most 5 metadata filters", r.text[:120])
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","topic:t:x")], headers=H("mem2")); chk("A3-43 first colon", r.status_code==200 and r.json()["total"]==0)
f = g(V1+"/items:metadata-facets").json(); print("facets", json.dumps(f)[:500]); chk("A3-46 paths", {p["path"] for p in f["paths"]}>={"meta.domain","meta.difficulty","meta.source.channel","meta.source.region","topic"}, [p["path"] for p in f["paths"]])
r = c.get(V1+"/items", params=[("project_slug","pa"),("meta","meta.source.region.code:sa")], headers=H("mem2")); chk("A3-45 4 levels", r.status_code==422, r.text[:100])
# batch
def bt(body, who="mem2", ver=V2): return c.post(ver+"/items:batch", params=P, headers=H(who), json=body)
r = bt({"filter":{"meta":{"meta.domain":"finance"}},"action":"disable"}, ver=V1); chk("A3-52 published dry run 409", r.status_code==409 and r.json()["detail"]=="Create a draft to edit items", r.text)
r = bt({"filter":{},"action":"disable"}); chk("A3-51 empty filter", r.status_code==422 and r.json()["detail"]=="Add a search, label, metadata or item filter before a batch edit", r.text)
r = bt({"filter":{"state":"all"},"action":"disable"}); chk("A3-51 state alone", r.status_code==422, r.text[:100])
r = bt({"filter":{"meta":{"meta.domain":"nothing"}},"action":"disable"}); chk("A3-53 none match", r.status_code==422 and r.json()["detail"]=="No items match this filter", r.text)
r = bt({"filter":{"meta":{"meta.domain":"finance"}},"action":"zap"}); chk("A3-55 action", r.status_code==422 and r.json()["detail"]=="action must be disable, enable or delete", r.text)
r = bt({"filter":{"meta":{"meta.domain":"finance"}},"action":"disable","reason":"y"*501}); chk("A3-55 reason", r.status_code==422 and "500" in r.text, r.text[:100])
r = bt({"filter":{"meta":{f"k{i}":"v" for i in range(6)}},"action":"disable"}); chk("A3-64 6 keys", r.status_code==422 and r.json()["detail"]=="Use at most 5 metadata filters", r.text[:100])
r = bt({"filter":{"meta":{"meta.domain":"finance","meta.source.region":"sa"}},"action":"disable"}); j=r.json(); chk("A3-48 dry default", r.status_code==200 and j["dry_run"] is True and j["matched"]==5 and j["affected"]==5, j)
before = g(V2+"/items", state="all").json()["counts"]; chk("A3-49 dry run wrote nothing", before["disabled"]==1, before)
r = bt({"filter":{"meta":{"meta.domain":"finance"}},"action":"disable","dry_run":False,"expected_affected":3}); chk("A3-54 expected mismatch", r.status_code==409 and r.json()["detail"]=="The matching items changed. Review the new count and try again.", r.text)
after = g(V2+"/items", state="all").json()["counts"]; chk("A3-54 nothing written", after==before, after)
r = bt({"filter":{"meta":{"meta.domain":"finance"}},"action":"disable","dry_run":False}); j=r.json(); chk("A3-50 apply", r.status_code==200 and j["dry_run"] is False, j)
after = g(V2+"/items", state="all").json()["counts"]; print("counts after", after)
r = bt({"filter":{"meta":{"meta.domain":"finance"}},"action":"enable","dry_run":False}); chk("enable batch", r.status_code==200, r.json())
r = bt({"filter":{"item_ids":["i2","i4","nope"]},"action":"disable","dry_run":True}); chk("A3-60 missing ids", r.json().get("missing_item_ids")==["nope"], r.json())
r = bt({"filter":{"search":"SECRETQ1"},"action":"disable"}); print("search batch", r.json())
r = bt({"filter":{"meta":{"meta.domain":"finance"}},"action":"disable"}, who="mem3"); chk("A3-56 none user", r.status_code==403, r.text)
r = c.post(V2+"/items:batch", params=P, headers=H("out"), json={"filter":{"meta":{"meta.domain":"finance"}},"action":"disable"}); chk("cross project batch", r.status_code==403, r.text)
# audit
r = g("/v1/datasets/qa/history"); print("history", r.status_code)
# publish -> hashes and copy
r = po(V2+":publish", {}); print("publish v2", r.status_code, r.text[:200])
r = g(U+"/versions").json(); print([(v["version"], v["item_count"], v.get("disabled_count"), v.get("content_hash","")[:8]) for v in (r["versions"] if isinstance(r,dict) else r)])
r = po(U+"/versions", {"from_version":"v2"}, who="mem2"); print("draft v3", r.status_code, r.json().get("version",{}).get("version"))
vs = g(U+"/versions").json(); vl = vs["versions"] if isinstance(vs,dict) else vs
j = g(U+"/versions/v3/items", state="disabled").json(); chk("A2-58 copy into draft", j["total"]>=1, j["total"])
r = po(U+"/versions/v2/items/i0:enable", {}); chk("A2-59 published v2 409", r.status_code==409, r.text)
r = c.patch(U+"/versions/v3/items/i0", params=P, headers=H("mem2"), json={"input":"hello","disabled":False}); print("patch with disabled field", r.status_code, r.text[:160])
r = g(U+"/versions/v3:compare", base="v2"); print("compare v3 v2", r.status_code, json.dumps(r.json())[:300])
po(U+"/versions/v3/items/i0:enable", {}); r = g(U+"/versions/v3:compare", base="v2"); j=r.json(); print("compare after enable", json.dumps(j)[:700])
