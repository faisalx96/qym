"""Live API checks for WP-A review against a platform in proxy_headers auth. usage: review-a-api.py BASE"""
import io, json, sys, httpx
B = sys.argv[1]; P = {"project_slug": "pa"}
def H(u): return {"X-User-Email": f"{u}@x.com", "Origin": "http://localhost:8000"}
c = httpx.Client(base_url=B, timeout=30)
res = []
def chk(id_, ok, note=""):
    res.append((id_, ok, note)); print(("PASS " if ok else "FAIL ") + id_, note)
def csv(rows):
    lines = ["id,input,expected_output,topic,meta"]
    for r in rows: lines.append(",".join('"%s"' % x.replace('"','""') for x in r))
    return "\n".join(lines) + "\n"
def up(u, name, rows, **kw):
    d = {"name": name, "project_slug": "pa", "id_col": "id", "metadata_cols": "topic,meta", **kw}
    return c.post("/v1/datasets:upload", headers=H(u), data=d, files={"file": ("d.csv", io.BytesIO(csv(rows).encode()), "text/csv")})
rows = []
for i in range(30):
    m = {"domain": ["finance","health"][i%2], "difficulty": i%3, "source": {"region": ["sa","ae","eg"][i%3], "channel": "web"}, "flag": i%2==0}
    rows.append((f"i{i}", f"SECRETQ{i}", f"ans{i}", "t", json.dumps(m)))
r = up("mem", "qa", rows, publish="true"); chk("upload", r.status_code==200, r.text[:100])
r = up("mem", "open", rows[:3], publish="true"); chk("upload-open", r.status_code==200)
URL = "/v1/datasets/qa"
d = c.get(URL, params=P, headers=H("mem")).json()
chk("A1-47 default access_mode", d.get("access_mode","?") in ("project",) or d["dataset"]["access_mode"]=="project" if "dataset" in d else True, str(list(d)[:6]))
perm = (d.get("dataset") or d).get("permissions"); print("creator perms", perm)
# restrict: mem2 view, mem3 none, mem creator
r = c.put(URL+"/access", params=P, headers=H("mem"), json={"access_mode":"restricted","grants":[]}); chk("A1-39 creator cannot PUT", r.status_code==403, f"{r.status_code} {r.json().get('detail')}")
r = c.put(URL+"/access", params=P, headers=H("mgr"), json={"access_mode":"restricted","grants":[{"user_id":"mem2","level":"view"}]}); chk("A1-39 manager PUT", r.status_code==200, r.text[:200])
for bad,exp in [({"access_mode":"x","grants":[]},"access_mode must be project or restricted"),({"access_mode":"restricted","grants":[{"user_id":"mem2","level":"z"}]},"level must be view or modify"),({"access_mode":"restricted","grants":[{"user_id":"mem2","level":"view"},{"user_id":"mem2","level":"view"}]},"Duplicate grant for user mem2"),({"access_mode":"restricted","grants":[{"user_id":"out","level":"view"}]},"User out is not an active member of this project")]:
    r = c.put(URL+"/access", params=P, headers=H("mgr"), json=bad); chk("A1-40 "+exp[:30], r.status_code==422 and r.json()["detail"]==exp, f"{r.status_code} {r.json()['detail']}")
r = c.get(URL+"/access", params=P, headers=H("mem2")); j=r.json(); chk("A1-37 viewer GET access", r.status_code==200 and j["candidates"]==[] and j["your_level"]=="view" and j["can_manage_access"] is False, json.dumps(j)[:300])
r = c.get(URL+"/access", params=P, headers=H("mgr")); j=r.json(); chk("A1-37 manager candidates", len(j["candidates"])>=1 and j["your_level"]=="manage", [x["id"] for x in j["candidates"]])
r = c.get(URL+"/access", params=P, headers=H("mem3")); chk("A1-44 none GET access 403", r.status_code==403 and r.json()["detail"]=="You don't have access to this dataset", r.text[:100])
# routes for none user
V = URL+"/versions/1"
routes = [("GET",URL),("GET",URL+"/versions"),("GET",V),("GET",V+"/items"),("GET",V+"/items/i0"),("GET",URL+"/runs"),("GET",URL+"/lineage"),("GET",V+":compare?base=v1"),("GET",V+":download"),("GET",V+"/items/i0/neighbors"),("GET","/api/datasets/qa/versions/1/items/i0/revisions"),("GET",V+"/items:metadata-facets"),("GET",V+"/items/i0/runs"),("GET",V+"/items/i0/lineage"),
 ("POST",V+"/items:batch"),("POST",URL+"/aliases/staging"),("PATCH",URL),("DELETE",URL),("POST",URL+"/versions"),("POST",V+"/items/i0:disable")]
for m,u in routes:
    kw = {"json":({"filter":{"search":"x"},"action":"disable","version":"v1"} if "batch" in u or "aliases" in u else {})} if m in ("POST","PATCH") else {}
    r = c.request(m,u.split("?")[0],params={**P,**({"base":"v1"} if "compare" in u else {})},headers=H("mem3"),**kw)
    chk(f"A1-44 none {m} {u.replace('/v1/datasets/qa','')}", r.status_code==403 and "access to this dataset" in r.text, f"{r.status_code} {r.text[:80]}")
r = c.get("/v1/datasets", params=P, headers=H("mem3")); names=[x["slug"] if "slug" in x else x["name"] for x in r.json().get("datasets", r.json() if isinstance(r.json(),list) else [])]; chk("A1-43 catalog omits for none", "qa" not in names and "open" in names, str(names))
r = c.get("/v1/datasets", params={**P,"include_inaccessible":"true"}, headers=H("mem3")); names=[x.get("slug") or x.get("name") for x in r.json().get("datasets", r.json() if isinstance(r.json(),list) else [])]; chk("include_inaccessible", "qa" in names, str(names)); 
r = c.get("/v1/datasets", params=P, headers=H("mem2")); names=[x.get("slug") for x in r.json().get("datasets",[])]; chk("catalog viewer sees qa", "qa" in names)
# view user writes
for m,u,body in [("POST",V+"/items:batch",{"filter":{"search":"x"},"action":"disable"}),("PATCH",URL,{"description":"x"}),("POST",URL+"/versions",{}),("POST",URL+"/aliases/staging",{"version":"v1"})]:
    r = c.request(m,u,params=P,headers=H("mem2"),json=body); chk(f"A1-46 view {m} {u[-25:]}", r.status_code==403 and r.json()["detail"]=="You can view this dataset but not change it", f"{r.status_code} {r.text[:90]}")
r = c.get(V+"/items", params=P, headers=H("mem2")); chk("view reads items", r.status_code==200 and r.json()["total"]==30)
# modify grant
r = c.put(URL+"/access", params=P, headers=H("mgr"), json={"access_mode":"restricted","grants":[{"user_id":"mem2","level":"modify"}]})
r = c.patch(URL, params=P, headers=H("mem2"), json={"description":"d"}); chk("modify can patch description", r.status_code==200, r.text[:80])
r = c.post(URL+"/aliases/production", params=P, headers=H("mem2"), json={"version":"v1"}); chk("modify cannot move production", r.status_code==403, f"{r.status_code} {r.text[:100]}")
r = c.delete(URL, params=P, headers=H("mem2")); chk("modify cannot delete", r.status_code==403, f"{r.status_code} {r.text[:100]}")
r = c.put(URL+"/access", params=P, headers=H("mem2"), json={"access_mode":"project","grants":[]}); chk("modify cannot PUT access", r.status_code==403 and r.json()["detail"]=="Only project managers and admins can change dataset access", r.text[:100])
# cross project
r = c.get(URL, params=P, headers=H("out")); chk("A1-49 outsider project error", r.status_code in (403,404) and "access to this dataset" not in r.text, f"{r.status_code} {r.text[:100]}")
# --- item state
r = c.post(URL+"/versions", params=P, headers=H("mem2"), json={"from_version":"v1"}); print("create draft", r.status_code); 
vs = c.get(URL+"/versions", params=P, headers=H("mgr")).json(); print([ (v.get("version"), v.get("status"), v.get("disabled_count")) for v in (vs.get("versions") if isinstance(vs,dict) else vs)])
