import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../server/app.mjs";
const db = { query: async () => ({ rows: [] }) };
test("Maps CSP is opt-in and retains unrelated protections", async () => {
  const off = await request(
    createApp(db, { googleMaps: false, logging: false }),
  ).get("/api/health");
  assert.ok(!off.headers["content-security-policy"].includes("google"));
  assert.ok(!off.headers["content-security-policy"].includes("unsafe-eval"));
  const on = await request(
    createApp(db, { googleMaps: true, production: true, logging: false }),
  ).get("/api/health");
  assert.match(on.headers["content-security-policy"], /googleapis.com/);
  assert.match(on.headers["content-security-policy"], /object-src 'none'/);
  assert.match(on.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(on.headers["permissions-policy"], "geolocation=(self)");
});
