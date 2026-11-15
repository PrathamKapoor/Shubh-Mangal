import test from "node:test";
import assert from "node:assert/strict";
import { createSiteConfig, plotPageTitle } from "../shared/site-config.mjs";

test("legacy default reproduces existing published and unavailable titles", () => {
  const config = createSiteConfig();
  assert.equal(config.name, "Shubh Mangal Residency");
  assert.equal(
    plotPageTitle(config, {
      publication: "published",
      number: "B1",
      block: "PLOT 1",
    }),
    "Plot B1 · PLOT 1 · Shubh Mangal Residency",
  );
  for (const plot of [
    null,
    { publication: "draft", number: "B1", block: "PLOT 1" },
  ])
    assert.equal(
      plotPageTitle(config, plot),
      "Plot unavailable · Shubh Mangal Residency",
    );
});

test("a second site's titles use its own identity without affecting the default", () => {
  const other = createSiteConfig({ name: "Harbour Gardens" });
  assert.equal(
    plotPageTitle(other, {
      publication: "published",
      number: "17",
      block: "South",
    }),
    "Plot 17 · South · Harbour Gardens",
  );
  assert.equal(
    plotPageTitle(other, null),
    "Plot unavailable · Harbour Gardens",
  );
  assert.equal(createSiteConfig().name, "Shubh Mangal Residency");
});

test("invalid explicit identity fails instead of silently using the legacy site", () => {
  for (const config of [null, {}, { name: "" }, { name: "   " }, { name: 4 }])
    assert.throws(() => createSiteConfig(config));
});

test("public project exposes only the configured public identity, with a legacy default", async () => {
  const { createApp } = await import("../server/app.mjs");
  const request = (await import("supertest")).default;
  const db = { query: async () => ({ rows: [] }) };
  const legacy = await request(
    createApp(db, { logging: false, siteConfig: createSiteConfig() }),
  ).get("/api/public/project");
  const alternate = await request(
    createApp(db, {
      logging: false,
      siteConfig: { name: "Harbour Gardens", secret: "private-value" },
    }),
  ).get("/api/public/project");
  assert.equal(legacy.status, 200);
  assert.deepEqual(legacy.body.siteConfig, { name: "Shubh Mangal Residency" });
  assert.equal(alternate.status, 200);
  assert.deepEqual(alternate.body.siteConfig, { name: "Harbour Gardens" });
  assert.ok(!JSON.stringify(alternate.body).includes("private-value"));
});
