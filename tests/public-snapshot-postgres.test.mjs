import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { validateDisposableTarget } from "../scripts/postgres-check.mjs";
import { loadPublicSnapshot } from "../server/public-snapshot.mjs";
import layout from "../public/data/layout.json" with { type: "json" };

test("Postgres snapshot remains consistent across a concurrent committed plot update", { skip: process.env.RUN_PUBLIC_SNAPSHOT_POSTGRES !== "true" }, async () => {
  const config = validateDisposableTarget(process.env);
  const pool = new pg.Pool({ ...config, max: 2 });
  const schema = `snapshot_${randomUUID().replaceAll("-", "")}`;
  const reader = await pool.connect(), writer = await pool.connect();
  try {
    await reader.query(`CREATE SCHEMA ${schema}`);
    await reader.query(`SET search_path TO ${schema}`);
    await writer.query(`SET search_path TO ${schema}`);
    await reader.query(`CREATE TABLE plots(id uuid PRIMARY KEY, number text, block text, data jsonb, publication text, status text, version integer, verified_at timestamptz, updated_at timestamptz, price_inr numeric, price_visible boolean);
      CREATE TABLE plot_geometry(plot_id uuid, draft_id text, revision_id text);
      CREATE TABLE draft_cells(id text, data jsonb);
      CREATE TABLE inventory_status_history(plot_id uuid, created_at timestamptz);`);
    const id = randomUUID();
    await reader.query("INSERT INTO plots(id,number,block,data,publication,status,version,price_visible) VALUES($1,'1','A','{}','published','available',1,false)", [id]);
    await reader.query("INSERT INTO plot_geometry VALUES($1,'cell','rev')", [id]);
    await reader.query("INSERT INTO draft_cells VALUES('cell',$1)", [JSON.stringify({ path: "M0,0 L10,0 L10,10 L0,10 Z" })]);
    const db = { transaction: async (fn) => {
      await reader.query("BEGIN");
      try { const value = await fn(reader); await reader.query("COMMIT"); return value; }
      catch (error) { await reader.query("ROLLBACK"); throw error; }
    } };
    const snapshot = await loadPublicSnapshot(db, layout, async (tx) => {
      const before = (await tx.query("SELECT status,version FROM plots WHERE id=$1", [id])).rows[0];
      await writer.query("UPDATE plots SET status='sold',version=2 WHERE id=$1", [id]);
      return before;
    });
    assert.deepEqual(snapshot.project, { status: "available", version: 1 });
    assert.equal(snapshot.plots[0].status, "available");
    assert.equal(snapshot.plots[0].version, 1);
    assert.equal(snapshot.geometry.features[0].properties.version, 1);
    assert.equal((await writer.query("SELECT status FROM plots WHERE id=$1", [id])).rows[0].status, "sold");
  } finally {
    await reader.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    reader.release(); writer.release(); await pool.end();
  }
});
