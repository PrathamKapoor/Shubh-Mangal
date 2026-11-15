import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { planToGeographic } from "../../shared/geography.mjs";
import layout from "../../public/data/layout.json" with {type:"json"};

async function login(page) {
  await page.goto("/admin");
  await page.getByLabel("Email",{exact:true}).fill("owner@example.invalid");
  await page.getByLabel("Password",{exact:true}).fill("Synthetic-test-only-927156!");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("button",{name:"Content",exact:true}).click();
}
async function setup(page,id,kind,data) {
  const session=await (await page.request.get("/api/auth/session")).json();
  const list=await (await page.request.get("/api/admin/content")).json();
  const old=list.items.find((item)=>item.id===id);
  const draft=old ? {...old.draft,title:"Initial synthetic revision"} : data;
  const put=async (version,publish)=> {
    const response=await page.request.put(`/api/admin/content/${id}`,{headers:{Origin:"http://127.0.0.1:5182","X-CSRF-Token":session.csrf,"Idempotency-Key":randomUUID()},data:{kind,data:draft,expectedVersion:version,publish,reason:"Synthetic competing editor setup"}});
    expect(response.status(),await response.text()).toBe(200); return response.json();
  };
  const saved=await put(old?.version ?? 0,false); await put(saved.version,true);
  await page.reload(); await page.getByRole("button",{name:"Content",exact:true}).click();
}
const locate=(page,id)=>page.locator("details.admin-card").filter({hasText:id});
const open=async (page,id)=>{const card=locate(page,id); await card.locator(":scope > summary").click(); return card;};
const publicTitle=async (page,id)=>{
  const project=await (await page.request.get("/api/public/project")).json();
  return project.items.find((item)=>item.id===id)?.published.title;
};
async function edit(card,title,reason) {
  await card.getByLabel("Name (English)",{exact:true}).fill(title);
  await card.getByLabel("Reason",{exact:true}).fill(reason);
  await card.getByRole("button",{name:"Save content"}).click();
}
async function publish(page,id,reason) {
  const card=await open(page,id);
  await card.getByLabel("Reason",{exact:true}).fill(reason);
  await card.getByLabel("Publish after evidence verification").check();
  await card.getByRole("button",{name:"Save content"}).click();
}
for (const kind of ["structure","site_access"]) {
  test(`two owner contexts resolve a stale ${kind} edit without losing input`,async ({browser})=>{
    const a=await browser.newContext({baseURL:"http://127.0.0.1:5182"});
    const b=await browser.newContext({baseURL:"http://127.0.0.1:5182"});
    try {
      const pa=await a.newPage(), pb=await b.newPage(); await login(pa); await login(pb);
      const point=([x,y])=>{const p=planToGeographic({x,y},layout);return [p.lon,p.lat];};
      const id=kind==="structure" ? "synthetic-concurrency-building" : "visitor-entrance";
      const input=kind==="structure" ? {
        title:"Initial synthetic revision",footprint:{datum:"WGS84",outer:[[4,4],[10,4],[10,10],[4,10],[4,4]].map(point),holes:[],source:"Synthetic fixture",sourceRevision:"one"},
        frame:{physicalAnchor:planToGeographic({x:4,y:4},layout),headingDegrees:0,modelAxes:"right-up-forward",worldAxes:"east-up-south",units:"metres",pivot:[0,0,0]},height:null,model:null,verifiedAt:"2026-01-01T00:00:00Z",customerVisible:true,
      } : {title:"Initial synthetic revision",routeAccess:{lat:24.466,lon:74.908},physicalAnchor:null,headingDegrees:null,state:"existing",source:"Synthetic fixture",sourceRevision:"one",verifiedAt:"2026-01-01T00:00:00Z",customerVisible:true};
      await setup(pa,id,kind,input); await pb.reload(); await pb.getByRole("button",{name:"Content",exact:true}).click();
      const ca=await open(pa,id), cb=await open(pb,id);
      await cb.getByLabel("Name (English)",{exact:true}).fill("Editor B unsaved");
      await edit(ca,"Editor A revision","Synthetic editor A draft");
      await expect.poll(()=>publicTitle(pa,id)).toBe("Initial synthetic revision");
      await publish(pa,id,"Synthetic editor A publish");
      await expect.poll(()=>publicTitle(pa,id)).toBe("Editor A revision");
      await cb.getByLabel("Reason",{exact:true}).fill("Synthetic editor B conflict");
      await cb.getByRole("button",{name:"Save content"}).click();
      await expect(pb.getByRole("alert")).toContainText("Content changed; reload it");
      await expect(cb.getByLabel("Name (English)",{exact:true})).toHaveValue("Editor B unsaved");
      expect(await publicTitle(pb,id)).toBe("Editor A revision");
      await pb.reload(); await pb.getByRole("button",{name:"Content",exact:true}).click();
      const refreshed=await open(pb,id);
      await expect(refreshed.getByLabel("Name (English)",{exact:true})).toHaveValue("Editor A revision");
      await edit(refreshed,"Editor B resolved","Synthetic editor B resolved");
      expect(await publicTitle(pb,id)).toBe("Editor A revision");
      await publish(pb,id,"Synthetic editor B publish");
      await expect.poll(()=>publicTitle(pb,id)).toBe("Editor B resolved");
      const audit=await (await pb.request.get(`/api/admin/audit?entity=${id}`)).json();
      const revisions=audit.events.filter((row)=>row.action==="content.update");
      expect(revisions.some((row)=>row.new_value?.published?.title==="Editor A revision")).toBe(true);
      expect(revisions.some((row)=>row.new_value?.published?.title==="Editor B resolved")).toBe(true);
    } finally {await a.close(); await b.close();}
  });
}
