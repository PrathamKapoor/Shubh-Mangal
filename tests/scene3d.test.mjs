import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import {
  classifyRings,
  fromWorld,
  ringsFromPath,
  toWorld,
} from "../shared/scene3d.mjs";

const layout = JSON.parse(await readFile("public/data/layout.json", "utf8"));
const geojson = JSON.parse(
  await readFile("public/data/reconstructed-cells.geojson", "utf8"),
);

test("map-to-world projection round trips and north is preserved", () => {
  const reference = layout.plots.find((plot) => plot.label === "B26");
  const before = structuredClone(reference);
  const world = toWorld(reference.center, 3);
  assert.deepEqual(world, [reference.center[0], 3, reference.center[1]]);
  assert.deepEqual(fromWorld(world), reference.center);
  assert.ok(
    toWorld([reference.center[0], reference.center[1] - 1])[2] < world[2],
  );
  assert.deepEqual(reference, before, "3D mapping must never mutate plot data");
  assert.equal(toWorld([NaN, 1]), null);
  assert.equal(toWorld([1, Infinity]), null);
  assert.equal(toWorld([1, 2], Infinity), null);
  assert.equal(fromWorld([1, NaN, 3]), null);
  assert.equal(fromWorld(null), null);
});

test("line paths preserve multipart rings and reject malformed geometry", () => {
  const paths = ringsFromPath(
    "M0 0 L10 0 10 10 0 10z m3 3 l4 0 0 4 -4 0z M20,20 L25,20 L25,25 L20,25 Z",
  );
  assert.equal(paths.length, 3);
  assert.deepEqual(paths[1], [
    [3, 3],
    [7, 3],
    [7, 7],
    [3, 7],
  ]);
  assert.deepEqual(ringsFromPath("M0 0 LInfinity 1 L2 2 Z"), []);
  assert.deepEqual(ringsFromPath("M0,0 C1,1 2,2 3,3 Z"), []);
  assert.deepEqual(ringsFromPath("M0,0 L1,1 L2,2 Z"), []);
  assert.deepEqual(ringsFromPath(null), []);
  assert.deepEqual(
    classifyRings([
      [
        [0, 0],
        [4, 4],
        [0, 3],
        [4, 0],
      ],
    ]),
    [],
  );
});

test("even-odd multipart geometry preserves holes and nested islands", () => {
  const rings = ringsFromPath(
    "M0,0 L10,0 L10,10 L0,10 Z M3,3 L3,7 L7,7 L7,3 Z M4,4 L6,4 L6,6 L4,6 Z M20,20 L25,20 L25,25 L20,25 Z",
  );
  const groups = classifyRings(rings.reverse());
  assert.equal(groups.length, 3, "outer, nested island and detached polygon");
  assert.equal(
    groups.reduce((sum, group) => sum + group.holes.length, 0),
    1,
  );
  const shapes = groups.map(({ outer, holes }) => {
    const draw = (shape, ring) => {
      shape.moveTo(...ring[0]);
      for (const point of ring.slice(1)) shape.lineTo(...point);
      shape.closePath();
      return shape;
    };
    const shape = draw(new THREE.Shape(), outer);
    shape.holes = holes.map((ring) => draw(new THREE.Path(), ring));
    return shape;
  });
  const geometry = new THREE.ShapeGeometry(shapes);
  const positions = geometry.getAttribute("position"),
    index = geometry.getIndex();
  let area = 0;
  for (let i = 0; i < index.count; i += 3) {
    const p = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map((n) => [
      positions.getX(n),
      positions.getY(n),
    ]);
    area +=
      Math.abs(
        (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) -
          (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]),
      ) / 2;
  }
  geometry.dispose();
  assert.ok(
    Math.abs(area - 113) < 1e-6,
    `filled area is ${area}, expected 100 - 16 + 4 + 25`,
  );
  const touching = classifyRings(
    ringsFromPath("M0,0 L10,0 L10,10 L0,10 Z M0,2 L4,2 L4,4 L0,4 Z"),
  );
  assert.equal(
    touching.reduce((sum, group) => sum + group.holes.length, 0),
    0,
    "boundary-touching rings are not silently classified as holes",
  );
});

test("all source plots and road rings survive 3D preparation with honest identities", () => {
  assert.equal(layout.plots.length, 556);
  assert.equal(geojson.features.length, layout.plots.length);
  assert.equal(
    new Set(layout.plots.map((plot) => plot.id)).size,
    layout.plots.length,
  );
  assert.deepEqual(
    new Set(layout.plots.map((plot) => plot.id)),
    new Set(geojson.features.map((feature) => feature.properties.id)),
    "every presentation candidate must retain its source geometry ID",
  );
  assert.equal(
    layout.plots.filter((plot) => plot.identityReviewRequired).length,
    32,
  );
  assert.ok(layout.plots.every((plot) => plot.status === "unverified"));
  assert.ok(
    geojson.features.every(
      (feature) => feature.properties.reviewRequired === true,
    ),
  );
  for (const plot of layout.plots) {
    const rings = ringsFromPath(plot.path);
    assert.equal(rings.length, 1, plot.id);
    assert.equal(classifyRings(rings).length, 1, plot.id);
  }
  const road = layout.areas.find((area) => area.kind === "road");
  const rings = ringsFromPath(road.path),
    groups = classifyRings(rings);
  assert.equal(rings.length, 31);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].holes.length, 30);
});
