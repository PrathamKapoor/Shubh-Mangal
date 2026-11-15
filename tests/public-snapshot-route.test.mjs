import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {randomUUID} from "node:crypto";
import {openDatabase,migrate} from "../server/db.mjs";
import {createApp} from "../server/app.mjs";

test("public snapshot returns one coherent whitelisted project, inventory and geometry",async ()=>{
  const db=await openDatabase({url:null,dir:":memory:"});
  try {
    await migrate(db);
    await db.query("INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES('fixture','fixture','{}')");
    await db.query("INSERT INTO draft_cells(id,revision_id,data) VALUES('cell','fixture',$1)",[JSON.stringify({path:"M100,100 L110,100 L110,110 L100,110 Z",privateNote:"PRIVATE-FIXTURE"})]);
    const id=randomUUID();
    await db.query("INSERT INTO plots(id,number,block,data,publication,verified_at,price_inr,price_visible) VALUES($1,'101','A',$2,'published',now(),999,false)",[id,JSON.stringify({number:"101",block:"A",sourceDocument:"Approved plan",sourceRevision:"r1",areaSqM:100,areaSourceText:"100 m2",reviewNote:"PRIVATE-FIXTURE",dimensions:[]})]);
    await db.query("INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,'cell','fixture')",[id]);
    const app=createApp(db,{demo:false,logging:false});
    const response=await request(app).get("/api/public/snapshot");
    assert.equal(response.status,200,JSON.stringify(response.body));
    assert.match(response.headers["cache-control"],/no-store/);
    assert.equal(response.body.plots.length,1);
    assert.equal(response.body.plots[0].id,id);
    assert.equal(response.body.plots[0].approved.areaSourceText,"100 m2");
    assert.equal(response.body.plots[0].priceINR,null);
    assert.equal(response.body.geometry.features[0].id,id);
    assert.equal(response.body.geometry.features[0].properties.version,response.body.plots[0].version);
    assert.doesNotMatch(JSON.stringify(response.body),/PRIVATE-FIXTURE/);
  } finally {await db.close();}
});
