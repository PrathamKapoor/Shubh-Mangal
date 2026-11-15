import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server/app.mjs";
import { openDatabase } from "../server/db.mjs";
import layout from "../public/data/layout.json" with { type: "json" };

test("selected layout exposes provisional source geometry only in demo mode", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    const connected = await request(createApp(db, { demo: false, logging: false })).get("/api/public/layout");
    assert.equal(connected.status, 200);
    assert.deepEqual(connected.body.geographicBounds, layout.geographicBounds);
    assert.deepEqual(connected.body.plots, []);
    assert.deepEqual(connected.body.areas, []);
    assert.deepEqual(connected.body.annotations, []);
    assert.match(connected.headers["cache-control"], /no-store/);
    const demo = await request(createApp(db, { demo: true, logging: false })).get("/api/public/layout");
    assert.equal(demo.status, 200);
    assert.equal(demo.body.plots.length, layout.plots.length);
    assert.equal(demo.body.areas.length, layout.areas.length);
  } finally { await db.close(); }
});
