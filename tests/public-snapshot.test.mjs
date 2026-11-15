import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate } from "../server/db.mjs";
import { loadPublicSnapshot } from "../server/public-snapshot.mjs";
import layout from "../public/data/layout.json" with { type: "json" };

test("snapshot includes only published plots and whitelisted inventory fields", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    await db.query("INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES('snap','snap','{}')");
    const ids = [randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) {
      await db.query("INSERT INTO draft_cells(id,revision_id,data) VALUES($1,'snap',$2)", [
        `cell-${index}`, JSON.stringify({ path: "M0,0 L10,0 L10,10 L0,10 Z", center: [5,5], geometrySource: "reviewed map", labelCandidates: ["1"], verifiedDimensions: null, privateNote: "SECRET", edges: [{ a: [0,0], b: [10,0], metres: 10, feet: 32.8, privateNote: "SECRET" }] }),
      ]);
      await db.query("INSERT INTO plots(id,number,block,data,publication,verified_at,price_inr,price_visible) VALUES($1,$2,'A',$3,$4,now(),999,false)", [id, String(index), JSON.stringify({ number: "1", block: "A", phase: "A", areaSourceText: "100 sq m", documentIds: ["public-doc"], sourceDocument: "survey map", sourceRevision: "rev-1", dimensions: [{ name: "North", metres: 10, sourceText: "10 m", privateNote: "SECRET" }], reviewNote: "SECRET", unknown: "SECRET" }), index ? "draft" : "published"]);
      await db.query("INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,$2,'snap')", [id, `cell-${index}`]);
    }
    const snapshot = await loadPublicSnapshot(db, layout, async (tx) => ({ count: Number((await tx.query("SELECT count(*) FROM plots WHERE publication='published'")).rows[0].count) }));
    assert.equal(snapshot.project.count, 1);
    assert.equal(snapshot.plots.length, 1);
    assert.equal(snapshot.plots[0].id, ids[0]);
    assert.equal(snapshot.plots[0].priceINR, null);
    assert.equal(snapshot.plots[0].geometrySource, "reviewed map");
    assert.deepEqual(snapshot.plots[0].labelCandidates, ["1"]);
    assert.deepEqual(snapshot.plots[0].approved, { number: "1", block: "A", phase: "A", areaSourceText: "100 sq m", documentIds: ["public-doc"], sourceDocument: "survey map", sourceRevision: "rev-1", dimensions: [{ name: "North", metres: 10, sourceText: "10 m" }], reviewNote: undefined });
    assert.equal(snapshot.geometry.features[0].id, ids[0]);
    assert.equal(snapshot.geometry.features[0].properties.version, snapshot.plots[0].version);
    assert.ok(!JSON.stringify(snapshot).includes("SECRET"));
  } finally { await db.close(); }
});

test("snapshot uses repeatable-read read-only transaction and propagates projection failures", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    const result = await loadPublicSnapshot(db, layout, async (tx) => {
      const settings = await tx.query("SELECT current_setting('transaction_isolation') AS isolation, current_setting('transaction_read_only') AS readonly");
      return settings.rows[0];
    });
    assert.deepEqual(result.project, { isolation: "repeatable read", readonly: "on" });
    await assert.rejects(loadPublicSnapshot(db, layout, async (tx) => tx.query("INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES('write','write','{}')")), /read.only/i);
    await assert.rejects(loadPublicSnapshot(db, layout, async () => { throw Error("projection failed"); }), /projection failed/);
    assert.equal((await db.query("SELECT 1 AS n")).rows[0].n, 1);
  } finally { await db.close(); }
});

test("snapshot inventory is complete beyond the public endpoint's 600-item page size", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    await db.query("INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES('bulk','bulk','{}')");
    await db.query(`INSERT INTO draft_cells(id,revision_id,data) SELECT 'cell-'||n,'bulk','{"path":"M0,0 L10,0 L10,10 L0,10 Z"}'::jsonb FROM generate_series(1,601) n`);
    await db.query(`INSERT INTO plots(id,number,block,data,publication,verified_at) SELECT gen_random_uuid(),n::text,'A','{}'::jsonb,'published',now() FROM generate_series(1,601) n`);
    await db.query(`INSERT INTO plot_geometry(plot_id,draft_id,revision_id) SELECT id,'cell-'||number,'bulk' FROM plots`);
    const result = await loadPublicSnapshot(db, layout, async () => ({ items: [] }));
    assert.equal(result.plots.length, 601);
    assert.equal(result.geometry.features.length, 601);
  } finally { await db.close(); }
});
