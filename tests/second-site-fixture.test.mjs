import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSiteSource } from "../shared/site-source.mjs";
import { planToGeographic, geographicToPlan, pathToGeographicGeometry } from "../shared/geography.mjs";
import { ringsFromPath } from "../shared/scene3d.mjs";

const directory = new URL("./fixtures/second-site/", import.meta.url);
const layout = JSON.parse(await readFile(new URL("layout.json", directory), "utf8"));
const source = JSON.parse(await readFile(new URL("source.json", directory), "utf8"));

test("second-site source is explicit, self-contained and uses distinct area IDs", async () => {
  const selected = createSiteSource(source);
  assert.equal(selected.name, layout.project);
  assert.equal(selected.layoutFile, "tests/fixtures/second-site/layout.json");
  assert.equal(selected.provenance.projection, "UTM 32N");
  assert.equal(selected.assets.schematic, "/synthetic/schematic.svg");
  assert.ok(selected.amenities.length >= 2);
  const schematic = await readFile(new URL("schematic.svg", directory), "utf8");
  assert.ok(schematic.includes("<svg") && schematic.includes('viewBox="0 0 50 60"'));
  for (const plot of layout.plots) assert.ok(schematic.includes(`>${plot.label}</text>`));
  const legacy = JSON.parse(await readFile(new URL("../public/data/layout.json", import.meta.url), "utf8"));
  const legacyAreaIds = new Set(legacy.areas.map((area) => area.id));
  const legacyPlotIds = new Set(legacy.plots.map((plot) => plot.id));
  assert.ok(layout.areas.length >= 3);
  assert.equal(new Set(layout.areas.map((a) => a.id)).size, layout.areas.length);
  for (const area of layout.areas) {
    assert.match(area.id, /^harbour-/);
    assert.ok(!legacyAreaIds.has(area.id));
    assert.ok(area.name && ["site", "road", "amenity"].includes(area.kind));
    assert.ok(ringsFromPath(area.path).length);
  }
  assert.ok(layout.plots.every((plot) => !legacyPlotIds.has(plot.id)));
  assert.doesNotMatch(JSON.stringify({ layout, source }), /Shubh Mangal|MAHENDRAR|area-(?:0|2|3|30|31|40)\b|UTM 43N/i);
});

test("synthetic plots have usable plan geometry, review metadata and UTM32 conversion", () => {
  assert.equal(layout.origin.utmZone, "32N");
  assert.ok(layout.plots.length >= 4);
  assert.equal(new Set(layout.plots.map((p) => p.id)).size, layout.plots.length);
  const [x, y, width, height] = layout.viewBox;
  const [west, south, east, north] = layout.geographicBounds;
  for (const plot of layout.plots) {
    assert.ok(plot.id && plot.label && plot.block);
    assert.equal(plot.status, "unverified");
    assert.equal(plot.verifiedDimensions, null);
    assert.equal(typeof plot.identityReviewRequired, "boolean");
    assert.ok(plot.labelCandidates.includes(plot.label));
    assert.match(plot.geometrySource, /synthetic/i);
    assert.ok(plot.areaSqMApprox > 0);
    const rings = ringsFromPath(plot.path);
    assert.equal(rings.length, 1);
    assert.ok(plot.center.every(Number.isFinite));
    assert.equal(plot.bounds.length, 4);
    assert.ok(plot.bounds.every(Number.isFinite));
    const [minX, minY, maxX, maxY] = plot.bounds;
    assert.ok(minX >= x && minY >= y && maxX <= x + width && maxY <= y + height);
    assert.ok(plot.center[0] >= minX && plot.center[0] <= maxX && plot.center[1] >= minY && plot.center[1] <= maxY);
    assert.equal(plot.edges.length, rings[0].length);
    for (const [index, edge] of plot.edges.entries()) {
      assert.ok(edge.a.every(Number.isFinite) && edge.b.every(Number.isFinite));
      assert.deepEqual(edge.a, rings[0][index]);
      assert.deepEqual(edge.b, rings[0][(index + 1) % rings[0].length]);
      assert.ok(Math.abs(edge.metres - Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1])) < 0.01);
      assert.ok(edge.metres > 0 && Math.abs(edge.feet * 0.3048 - edge.metres) < 0.01);
    }
    const geometry = pathToGeographicGeometry(plot.path, layout);
    assert.equal(geometry.type, "Polygon");
    for (const [lon, lat] of geometry.coordinates[0]) assert.ok(lon >= west && lon <= east && lat >= south && lat <= north);
    const point = { x: plot.center[0], y: plot.center[1] };
    const roundtrip = geographicToPlan(planToGeographic(point, layout), layout);
    assert.ok(Math.hypot(roundtrip.x - point.x, roundtrip.y - point.y) < 0.001);
  }
  assert.ok(Array.isArray(layout.annotations));
});
