import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { openDatabase, migrate } from "../server/db.mjs";
import { createUser } from "../server/auth.mjs";
import { createApp } from "../server/app.mjs";
import { planToGeographic } from "../shared/geography.mjs";
import layout from "../public/data/layout.json" with { type: "json" };

test("publication rejects cross-revision parcel overlaps in both orders, but permits shared boundaries", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    const origin = "http://localhost:5173", password = "Synthetic-overlap-test-927156!";
    await createUser(db, { email: "overlap@example.invalid", name: "Synthetic owner", password, role: "owner" });
    const app = createApp(db, { origin, demo: false, logging: false });
    const agent = request.agent(app);
    const login = await agent.post("/api/auth/login").set("Origin", origin).send({ email: "overlap@example.invalid", password });
    assert.equal(login.status, 200);
    const coordinate = ([x,y]) => { const p = planToGeographic({x,y}, layout); return [p.lon,p.lat]; };
    const shape = (x1,y1,x2,y2) => [[x1,y1],[x2,y1],[x2,y2],[x1,y2],[x1,y1]].map(coordinate);
    const outer = shape(100,100,110,110);
    const cases = [
      ["duplicate", outer, true],
      ["contained", shape(102,102,108,108), true],
      ["crossing", shape(105,105,115,115), true],
      ["shared boundary", shape(110,100,120,110), false],
    ];
    for (const [label, second, overlap] of cases) for (const reverse of [false,true]) {
      await db.query("UPDATE plots SET publication='reviewed' WHERE publication='published'");
      const ids = [randomUUID(), randomUUID()];
      const geometries = reverse ? [second,outer] : [outer,second];
      for (let i=0;i<2;i++) {
        const revision = `revision-${randomUUID()}`, cell = `cell-${randomUUID()}`;
        await db.query("INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES($1,$1,'{}')", [revision]);
        await db.query("INSERT INTO draft_cells(id,revision_id,data) VALUES($1,$2,$3)", [cell,revision,JSON.stringify({ geographicGeometry:{type:"Polygon",coordinates:[geometries[i]]} })]);
        await db.query("INSERT INTO plots(id,number,block,data,publication,verified_at) VALUES($1,$2,'TEST',$3,'reviewed',now())", [ids[i],ids[i],JSON.stringify({number:ids[i],block:"TEST"})]);
        await db.query("INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,$2,$3)", [ids[i],cell,revision]);
      }
      const publish = (id) => agent.patch(`/api/admin/plots/${id}`).set("Origin",origin).set("X-CSRF-Token",login.body.csrf).set("Idempotency-Key",randomUUID()).send({publication:"published",expectedVersion:1,reason:"Synthetic cross revision publication"});
      assert.equal((await publish(ids[0])).status,200,`${label} first`);
      const result = await publish(ids[1]);
      assert.equal(result.status,overlap ? 422 : 200,`${label} reverse=${reverse}: ${JSON.stringify(result.body)}`);
      const row=(await db.query("SELECT publication,version FROM plots WHERE id=$1",[ids[1]])).rows[0];
      assert.equal(row.publication,overlap ? "reviewed" : "published");
      assert.equal(row.version,overlap ? 1 : 2);
      const audits=(await db.query("SELECT action FROM audit_logs WHERE entity_id=$1",[ids[1]])).rows;
      assert.deepEqual(audits.map((entry)=>entry.action),overlap ? [] : ["plot.update"]);
    }
  } finally { await db.close(); }
});
