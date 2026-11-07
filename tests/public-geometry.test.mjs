import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate } from "../server/db.mjs";
import { createApp } from "../server/app.mjs";

test("public geographic snapshot preserves IDs, hides drafts/private fields and drops reassigned shapes", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    const app = createApp(db, { demo: false, logging: false });
    const empty = await request(app).get("/api/public/geometry");
    assert.equal(empty.body.type, "FeatureCollection");
    assert.deepEqual(empty.body.features, []);
    await db.query(
      "INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES('fixture','fixture','{}')",
    );
    for (const [id, x] of [
      ["old", 100],
      ["shifted", 200],
      ["hidden", 300],
    ])
      await db.query(
        "INSERT INTO draft_cells(id,revision_id,data) VALUES($1,'fixture',$2)",
        [
          id,
          JSON.stringify({
            path: `M${x},100 L${x + 10},100 L${x + 10},110 L${x},110 Z`,
            privateNote: "PRIVATE-FIXTURE",
          }),
        ],
      );
    const id = randomUUID(),
      hidden = randomUUID();
    for (const [uuid, publication, cell] of [
      [id, "published", "old"],
      [hidden, "draft", "hidden"],
    ]) {
      await db.query(
        "INSERT INTO plots(id,number,block,data,publication,verified_at,price_inr,price_visible) VALUES($1,$2,'TEST',$3,$4,now(),999,false)",
        [
          uuid,
          cell,
          JSON.stringify({ reviewNote: "PRIVATE-FIXTURE" }),
          publication,
        ],
      );
      await db.query(
        "INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,$2,'fixture')",
        [uuid, cell],
      );
    }
    const first = await request(app).get("/api/public/geometry");
    assert.equal(first.body.features.length, 1);
    assert.equal(first.body.features[0].id, id);
    assert.equal(first.body.features[0].properties.geometryId, "old");
    assert.equal(first.body.features[0].geometry.type, "Polygon");
    assert.ok(!JSON.stringify(first.body).includes("PRIVATE-FIXTURE"));
    assert.equal(first.body.features[0].properties.priceINR, undefined);
    assert.equal(first.body.features[0].properties.price_inr, undefined);
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE plot_geometry SET draft_id='shifted' WHERE plot_id=$1",
        [id],
      );
      await tx.query("UPDATE plots SET version=version+1 WHERE id=$1", [id]);
    });
    const next = await request(app).get("/api/public/geometry");
    assert.equal(next.body.features[0].id, id);
    assert.equal(next.body.features[0].properties.geometryId, "shifted");
    assert.notEqual(next.body.snapshot, first.body.snapshot);
    assert.notDeepEqual(
      next.body.features[0].geometry,
      first.body.features[0].geometry,
    );
    await db.query("UPDATE plots SET publication='draft' WHERE id=$1", [id]);
    assert.deepEqual(
      (await request(app).get("/api/public/geometry")).body.features,
      [],
    );
  } finally {
    await db.close();
  }
});
