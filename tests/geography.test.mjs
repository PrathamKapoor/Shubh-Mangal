import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as geography from "../shared/geography.mjs";
import { ringsFromPath, classifyRings } from "../shared/scene3d.mjs";

const source = await readFile(
  new URL("../public/data/layout.json", import.meta.url),
  "utf8",
);
const layout = JSON.parse(source);
const secondSite = {
  origin: {
    utmZone: "56S",
    datum: "WGS84",
    units: "m",
    easting: 333374.81569498853,
    northingTop: 6258562.961119425,
  },
  geographicBounds: [151.19, -33.81, 151.21, -33.79],
};
const near = (actual, expected, tolerance) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );

test("layout metadata determines projection, including a second southern UTM site", () => {
  assert.match(geography.projectionFromLayout(layout), /\+zone=43\b/);
  assert.match(geography.projectionFromLayout(layout), /\+datum=WGS84\b/);
  assert.match(geography.projectionFromLayout(layout), /\+units=m\b/);
  assert.match(
    geography.projectionFromLayout(secondSite),
    /\+zone=56\b.*\+south\b/,
  );
  const point = geography.geographicToPlan(
    { lat: -33.8, lon: 151.2 },
    secondSite,
  );
  near(point.x, 0, 1e-6);
  near(point.y, 0, 1e-6);
  const restored = geography.planToGeographic(
    { x: 137.123, y: 281.456 },
    secondSite,
  );
  const plan = geography.geographicToPlan(restored, secondSite);
  near(plan.x, 137.123, 1e-6);
  near(plan.y, 281.456, 1e-6);
});

test("legacy origin and asymmetric corner retain precision and north/south orientation", () => {
  const origin = geography.planToGeographic({ x: 0, y: 0 }, layout);
  near(origin.lat, 24.468345860208117, 1e-11);
  near(origin.lon, 74.90715387910585, 1e-11);
  const corner = geography.geographicToPlan(
    { lat: 24.466625094839895, lon: 74.90772115039721 },
    layout,
  );
  near(corner.x, 57.36, 1e-6);
  near(corner.y, 190.563, 1e-6);
  for (const point of [
    { x: 0, y: 0 },
    { x: 71.123456, y: 293.765432 },
  ]) {
    const result = geography.geographicToPlan(
      geography.planToGeographic(point, layout),
      layout,
    );
    near(result.x, point.x, 1e-6);
    near(result.y, point.y, 1e-6);
  }
});

test("invalid metadata fails closed without a default origin or zone", () => {
  for (const invalid of [
    null,
    {},
    { ...layout, origin: undefined },
    ...["", "0N", "61N", "43", "43X", 43].map((utmZone) => ({
      ...layout,
      origin: { ...layout.origin, utmZone },
    })),
    ...[
      { datum: "NAD83" },
      { datum: null },
      { units: "ft" },
      { easting: NaN },
      { easting: "490591" },
      { northingTop: Infinity },
    ].map((change) => ({ ...layout, origin: { ...layout.origin, ...change } })),
    ...[
      undefined,
      [1, 2, 3],
      [75, 24, 74, 25],
      [74, 25, 75, 24],
      [74, -91, 75, 24],
      [74, 24, 181, 25],
      [NaN, 24, 75, 25],
      [24.46, 74.9, 24.48, 74.92],
    ].map((geographicBounds) => ({ ...layout, geographicBounds })),
  ])
    assert.throws(() => geography.projectionFromLayout(invalid));
  assert.throws(() => geography.geographicToPlan({ lat: 24.466, lon: 74.909 }));
  assert.throws(() => geography.planToGeographic({ x: 0, y: 0 }));
});

test("global coordinate validation and opt-in site bounds reject invalid input", () => {
  for (const point of [
    null,
    {},
    { lat: NaN, lon: 74.909 },
    { lat: 24.466, lon: Infinity },
    { lat: "24.466", lon: 74.909 },
    { lat: 91, lon: 75 },
    { lat: 24, lon: 181 },
    { lat: 24, lng: 75 },
  ]) {
    assert.throws(() => geography.geographicToPlan(point, layout));
  }
  for (const point of [
    { lat: 74.909, lon: 24.466 },
    { lat: 25, lon: 75 },
  ]) {
    assert.ok(Number.isFinite(geography.geographicToPlan(point, layout).x));
    assert.throws(() =>
      geography.geographicToPlan(point, layout, { enforceBounds: true }),
    );
  }
  for (const point of [
    null,
    {},
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
    { x: "0", y: 0 },
    { x: 1e308, y: -1e308 },
  ]) {
    assert.throws(() => geography.planToGeographic(point, layout));
  }
  assert.deepEqual(geography.toGooglePosition({ lat: -33.8, lon: 151.2 }), {
    lat: -33.8,
    lng: 151.2,
  });
  for (const point of [
    { lat: Infinity, lon: 0 },
    { lat: 91, lon: 0 },
    { lat: 0, lon: -181 },
    { lat: 0, lng: 0 },
  ])
    assert.throws(() => geography.toGooglePosition(point));
});

const area = (ring) =>
  ring.slice(0, -1).reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[i + 1];
    return sum + x * ny - nx * y;
  }, 0);
function checkGeometry(geometry) {
  assert.ok(geometry);
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons)
    for (const [i, ring] of polygon.entries()) {
      assert.deepEqual(ring[0], ring.at(-1));
      assert.ok(ring.length >= 4);
      assert.ok(i === 0 ? area(ring) > 0 : area(ring) < 0, "RFC 7946 winding");
      for (const [lon, lat] of ring)
        assert.ok(Math.abs(lon) <= 180 && Math.abs(lat) <= 90);
    }
  return polygons;
}

test("source road retains every hole and source paths remain byte-for-byte unchanged", async () => {
  const before = JSON.stringify(layout);
  const road = layout.areas.find((a) => a.kind === "road");
  const groups = classifyRings(ringsFromPath(road.path));
  const polygons = checkGeometry(
    geography.pathToGeographicGeometry(road.path, layout),
  );
  assert.ok(groups.some((g) => g.holes.length > 0));
  assert.equal(polygons.length, groups.length);
  assert.equal(polygons.flat().length, 31);
  for (const item of [...layout.plots, ...layout.areas]) {
    const geometry = geography.pathToGeographicGeometry(item.path, layout);
    const originals = ringsFromPath(item.path).flat();
    assert.ok(geometry, item.id);
    for (const polygon of checkGeometry(geometry))
      for (const ring of polygon)
        for (const [lon, lat] of ring) {
          const point = geography.geographicToPlan({ lat, lon }, layout);
          assert.ok(
            originals.some(
              ([x, y]) => Math.hypot(point.x - x, point.y - y) < 0.00071,
            ),
            "legacy millimetre path precision",
          );
        }
  }
  assert.equal(JSON.stringify(layout), before);
  assert.equal(
    await readFile(
      new URL("../public/data/layout.json", import.meta.url),
      "utf8",
    ),
    source,
  );
});

test("nested islands, holes, multipart and relative line paths survive conversion", () => {
  const geometry = geography.pathToGeographicGeometry(
    "M0 0 L30 0 30 30 0 30z m3 3 l0 24 24 0 0 -24z M5 5L10 5 10 10 5 10z M40 40L45 40 45 45 40 45z",
    layout,
  );
  assert.equal(geometry.type, "MultiPolygon");
  const polygons = checkGeometry(geometry);
  assert.equal(polygons.length, 3);
  assert.equal(polygons.flat().length, 4);
  assert.equal(
    geography.pathToGeographicGeometry("M0 0L10 0 10 10 0 10Z", layout).type,
    "Polygon",
  );
});

test("malformed paths or any invalid ring fail the whole geometry", () => {
  const valid = "M0 0L10 0 10 10 0 10Z";
  for (const path of [
    null,
    "",
    "M0 0C1 1 2 2 3 3Z",
    "L0 0L10 0 10 10Z",
    "M0 0L1e999 0 2 2Z",
    "M0 0L10 0 10 10",
    `${valid} M20 20L21 21 22 22Z`,
    `${valid} M20 20Z`,
    `${valid} M20 20L24 24 20 23 24 20Z`,
    `${valid} M20 20L24 20 24 24 22 22 20 24 22 22Z`,
    `${valid} garbage`,
  ]) {
    assert.equal(
      geography.pathToGeographicGeometry(path, layout),
      null,
      String(path),
    );
  }
  assert.equal(geography.pathToGeographicGeometry(valid, {}), null);
});
