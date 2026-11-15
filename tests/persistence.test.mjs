import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { openDatabase, migrate } from "../server/db.mjs";
test("local PostgreSQL database survives reopen and physical backup/restore preserves records", async () => {
  const root = await mkdtemp(join(tmpdir(), "shubh-persistence-")),
    dir = join(root, "original");
  let db;
  try {
    db = await openDatabase({ url: null, dir });
    await migrate(db);
    const id = randomUUID();
    await db.query("INSERT INTO enquiries(id,data) VALUES($1,$2)", [
      id,
      JSON.stringify({ name: "Synthetic persistence fixture", consent: true }),
    ]);
    await db.close();
    db = null;
    const raw = new PGlite(dir);
    await raw.waitReady;
    assert.equal((await raw.query("SELECT id FROM enquiries")).rows[0].id, id);
    const blob = await raw.dumpDataDir();
    await raw.close();
    const restored = new PGlite(join(root, "restored"), { loadDataDir: blob });
    await restored.waitReady;
    assert.equal(
      (await restored.query("SELECT data FROM enquiries")).rows[0].data.name,
      "Synthetic persistence fixture",
    );
    assert.equal(
      (await restored.query("SELECT version FROM schema_migrations")).rows[0]
        .version,
      "001_initial.sql",
    );
    await restored.close();
  } finally {
    if (db) await db.close();
    await rm(root, { recursive: true, force: true });
  }
});
