import test from "node:test";
import assert from "node:assert/strict";
import { isLegacyReferenceMismatch, loadSelectedLayout } from "../src/services/layout.js";

const layout = { project: "Synthetic Harbour Gardens", origin: { utmZone: "32N", easting: 500000, northingTop: 5538630 }, geographicBounds: [8.99, 49.99, 9.01, 50.01], viewBox: [0, 0, 50, 60], plots: [], areas: [] };
const legacy = { ...layout, project: "Shubh Mangal Residency" };
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function mock(routes) {
  const calls = [];
  return { calls, fetch: async (url, options) => {
    calls.push(url);
    const result = routes[url];
    if (result instanceof Error) throw result;
    assert.ok(result, `unexpected request: ${url}`);
    assert.ok(options?.signal);
    return result;
  } };
}
const signal = new AbortController().signal;

test("selected API layout is used without requesting legacy data", async () => {
  const http = mock({ "/api/public/layout": response(200, layout) });
  assert.deepEqual(await loadSelectedLayout({ signal, fetchImpl: http.fetch }), { layout, source: "api" });
  assert.deepEqual(http.calls, ["/api/public/layout"]);
});

test("only unavailable API and explicit offline permission allow the legacy reference", async () => {
  const http = mock({ "/api/public/layout": response(503), "/api/public/project": new TypeError("offline"), "/data/layout.json": response(200, legacy) });
  assert.deepEqual(await loadSelectedLayout({ signal, fetchImpl: http.fetch, allowOffline: true }), { layout: legacy, source: "offline-legacy" });
  const editor = mock({ "/api/public/layout": response(503), "/api/public/project": new TypeError("offline") });
  await assert.rejects(loadSelectedLayout({ signal, fetchImpl: editor.fetch }), /unavailable/i);
  assert.ok(!editor.calls.includes("/data/layout.json"));
});

test("legacy demo fallback requires a reachable matching identity", async () => {
  const http = mock({ "/api/public/layout": response(404), "/api/public/project": response(200, { mode: "local-demo", siteConfig: { name: "Shubh Mangal Residency" }, geographicBounds: legacy.geographicBounds }), "/data/layout.json": response(200, legacy) });
  assert.deepEqual(await loadSelectedLayout({ signal, fetchImpl: http.fetch }), { layout: legacy, source: "demo-legacy" });
  for (const project of [{ mode: "connected", siteConfig: { name: legacy.project } }, { mode: "local-demo", siteConfig: { name: layout.project } }]) {
    const other = mock({ "/api/public/layout": response(404), "/api/public/project": response(200, project) });
    await assert.rejects(loadSelectedLayout({ signal, fetchImpl: other.fetch, allowOffline: true }), /unavailable/i);
    assert.ok(!other.calls.includes("/data/layout.json"));
  }
});

test("invalid, unauthorized and aborted responses never fall back", async () => {
  for (const result of [response(200, {}), response(403), new DOMException("cancelled", "AbortError")]) {
    const http = mock({ "/api/public/layout": result });
    await assert.rejects(loadSelectedLayout({ signal, fetchImpl: http.fetch, allowOffline: true }));
    assert.deepEqual(http.calls, ["/api/public/layout"]);
  }
  const wrong = mock({ "/api/public/layout": response(404), "/api/public/project": response(200, { mode: "local-demo", siteConfig: { name: legacy.project }, geographicBounds: legacy.geographicBounds }), "/data/layout.json": response(200, layout) });
  await assert.rejects(loadSelectedLayout({ signal, fetchImpl: wrong.fetch }), /legacy/i);
  const wrongBounds = mock({ "/api/public/layout": response(404), "/api/public/project": response(200, { mode: "local-demo", siteConfig: { name: legacy.project }, geographicBounds: [0, 0, 1, 1] }), "/data/layout.json": response(200, legacy) });
  await assert.rejects(loadSelectedLayout({ signal, fetchImpl: wrongBounds.fetch }), /legacy/i);
});

test("a legacy fallback is hidden when a connected or different demo site is discovered", () => {
  for (const source of ["offline-legacy", "demo-legacy"]) {
    const result = { layout: legacy, source };
    assert.equal(isLegacyReferenceMismatch(result, "connected", legacy.project), true);
    assert.equal(isLegacyReferenceMismatch(result, "local-demo", layout.project), true);
    assert.equal(isLegacyReferenceMismatch(result, "local-demo", legacy.project, legacy.geographicBounds), false);
    assert.equal(isLegacyReferenceMismatch(result, "local-demo", legacy.project, [0, 0, 1, 1]), true);
    assert.equal(isLegacyReferenceMismatch(result, "offline", legacy.project), false);
  }
  assert.equal(isLegacyReferenceMismatch({ layout, source: "api" }, "connected", layout.project), false);
});
