import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../server/db.mjs";

test("explicit url:null uses in-memory storage despite an inherited DATABASE_URL", async () => {
  const previousUrl = process.env.DATABASE_URL;
  let db;
  try {
    process.env.DATABASE_URL =
      "postgresql://synthetic:synthetic@127.0.0.1:1/must_not_connect";
    db = await openDatabase({ url: null, dir: ":memory:" });
    assert.equal(db.kind, "local-pglite");
    await db.exec("CREATE TABLE isolation_probe (value text NOT NULL)");
    await db.query("INSERT INTO isolation_probe(value) VALUES ($1)", [
      "Synthetic isolation fixture",
    ]);
    assert.deepEqual(
      (await db.query("SELECT value FROM isolation_probe")).rows,
      [{ value: "Synthetic isolation fixture" }],
    );
  } finally {
    try {
      await db?.close();
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  }
});
