import sys, json, httpx
sys.path.insert(0, "frontend/scripts")
from seed_experiments import seed
BASE="http://127.0.0.1:8988"; SLUG="exp-demo"
for port, tasks in ((9088, [{"id":"answer-ticket","name":"Answer ticket","description":"Reply to a support ticket","default":True},{"id":"classify-intent","name":"Classify intent","description":"Route a message to a queue","default":False},{"id":"summarize","name":"Summarize thread","description":None,"default":False}]),
                    (9089, [{"id":"answer-ticket","name":"Answer ticket","description":"Reply to a support ticket","default":True},{"id":"classify-intent","name":"Classify intent","description":"Route a message to a queue","default":False}])):
    httpx.post(f"http://127.0.0.1:{port}/__control/tasks", json={"tasks":tasks}).raise_for_status()
c=httpx.Client(base_url=BASE, timeout=60)
r=c.post("/v1/projects", json={"name":"Exp Demo","slug":SLUG}); 
def items(n,p): return [{"item_id":f"{p}-{i}","input":f"question {i}","expected_output":f"answer {i}"} for i in range(n)]
for name,vers in (("support-tickets",3),("billing-faq",2),("refund-cases",1),("golden",1)):
    c.post("/v1/datasets", json={"project_slug":SLUG,"name":name,"description":"demo"}).raise_for_status()
    for v in range(1,vers+1):
        c.post(f"/v1/datasets/{name}/versions?project_slug={SLUG}", json={"from_version":f"v{v-1}"} if v>1 else {}).raise_for_status()
        c.post(f"/v1/datasets/{name}/versions/v{v}/items:bulk?project_slug={SLUG}", json={"upserts":items(6+v,name[:3])}).raise_for_status()
        c.post(f"/v1/datasets/{name}/versions/v{v}:publish?project_slug={SLUG}", json={"set_alias":"production"} if v==vers else {}).raise_for_status()
out=seed(BASE,SLUG,"http://127.0.0.1:9088","http://127.0.0.1:9089")
print(json.dumps(out)[:1500])
