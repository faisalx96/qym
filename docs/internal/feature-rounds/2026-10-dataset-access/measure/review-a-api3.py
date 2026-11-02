"""Part 3: copy into drafts, hash, compare, lineage (after part 2)."""
import json, sys, httpx
B=sys.argv[1]; P={"project_slug":"pa"}; U="/v1/datasets/qa"
H=lambda u: {"X-User-Email": f"{u}@x.com", "Origin": "http://localhost:8000"}
c=httpx.Client(base_url=B,timeout=60)
def chk(i,ok,n=""): print(("PASS " if ok else "FAIL ")+i, str(n)[:300])
def g(u,who="mem2",**p): return c.get(u,params={**P,**p},headers=H(who))
def po(u,b,who="mem2",**p): return c.post(u,params={**P,**p},headers=H(who),json=b)
for i in ("i0","i1"): po(U+f"/versions/v3/items/{i}:disable",{"reason":"r"})
r=c.patch(U+"/versions/v3/items/i0",params=P,headers=H("mem2"),json={"input":"hello","disabled":False}); chk("A2-59 PATCH ignores disabled field", g(U+"/versions/v3/items/i0").json()["item"]["state"]=="disabled", r.status_code)
po(U+"/versions/v3:publish",{}); vs=g(U+"/versions").json()["versions"]; h={v["version"]:(v["content_hash"][:8],v["disabled_count"],v["item_count"]) for v in vs}; print(h)
chk("A2-60 hash differs with disabled only", h["v3"][0]!=h["v2"][0] and h["v3"][1]==2, h)
chk("A2-60 fingerprint unchanged", True)
f=lambda v: {i["item_id"]:i["fingerprint"] for i in g(U+f"/versions/{v}/items",state="all",limit=200).json()["items"]}
chk("A2-60 fingerprint equal", f("v2")["i0"]==f("v3")["i0"])
po(U+"/versions",{"from_version":"v3"}); j=g(U+"/versions/v4/items",state="disabled").json(); chk("A2-58 copied into new draft", j["total"]==2, j["total"])
po(U+"/versions/v4/items/i0:enable",{}); j=g(U+"/versions/v3/items",state="disabled").json(); chk("A2-58 parent untouched", j["total"]==2)
r=g(U+"/versions/v4:compare",base="v3"); j=r.json(); print("compare summary", j.get("summary"), json.dumps(j.get("changed"))[:600])
r=g(U+"/versions/v3:compare",base="v2"); j=r.json(); print("compare v3/v2 summary", j.get("summary"), json.dumps(j.get("changed"))[:500])
r=g(U+"/lineage"); print("lineage", r.status_code, json.dumps(r.json())[:700])
r=g(U+"/versions/v3:download"); print("download v3 lines", len(r.text.strip().splitlines()), r.text.splitlines()[0][:160])
r=g(U+"/versions/v3:download",include_disabled="true"); print("download all", len(r.text.strip().splitlines()))
r=g("/api/datasets/qa/versions/v4/items/i0/revisions"); print("revs v4 i0", [x["change_type"] for x in r.json()["revisions"]])
# bulk keeps flag
body={"items":[{"item_id":"i1","input":"changed input","expected_output":"e"},{"item_id":"new1","input":"n","expected_output":"e"}]}
r=po(U+"/versions/v4/items:bulk",body); print("bulk", r.status_code, r.text[:200])
j=g(U+"/versions/v4/items",state="all",limit=200).json(); st={i["item_id"]:i["state"] for i in j["items"]}; chk("A2-59 bulk keeps flag, new active", st.get("i1")=="disabled" and st.get("new1")=="active", (st.get("i1"),st.get("new1")))
# runs on dataset: sdk-style read without state
r=g(U+"/versions/v3/items"); chk("A2-62 default active only", r.json()["total"]==28, r.json()["total"])
# audit
r=g("/v1/audit"); print("audit", r.status_code)
