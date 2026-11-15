import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { planToGeographic } from "../shared/geography.mjs";
import {
  createFootprint3D,
  modelPointToWorld,
} from "../shared/footprint3d.mjs";

const layout = JSON.parse(await readFile("public/data/layout.json", "utf8"));
const geo = ([x, y]) => {
  const { lon, lat } = planToGeographic({ x, y }, layout);
  return [lon, lat];
};
const outer = [
  [100, 100],
  [112, 100],
  [112, 104],
  [105, 104],
  [105, 110],
  [100, 110],
  [100, 100],
];
const hole = [
  [101, 101],
  [103, 101],
  [103, 103],
  [101, 103],
  [101, 101],
];
const access = {
  physicalAnchor: planToGeographic({ x: 102, y: 105 }, layout),
  headingDegrees: 90,
  footprint: { datum: "WGS84", outer: outer.map(geo), holes: [hole.map(geo)] },
};
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`);

test("projected asymmetric footprint and hole retain actual positions, independently of heading", () => {
  const before = structuredClone(access);
  const model = createFootprint3D(access, layout);
  assert.equal(model.rings.length, 2);
  for (const [ring, expected] of [
    [model.rings[0], outer],
    [model.rings[1], hole],
  ]) {
    assert.equal(ring.length, expected.length - 1);
    ring.forEach((p, i) => {
      close(p[0], expected[i][0]);
      close(p[1], 0);
      close(p[2], expected[i][1]);
    });
  }
  assert.deepEqual(access, before);
  assert.equal(model.heightMeters, null);
  assert.deepEqual(
    createFootprint3D({ ...access, headingDegrees: 0 }, layout).rings,
    model.rings,
  );
});

test("anchor and clockwise heading transform local right/up/forward into world coordinates", () => {
  const model = createFootprint3D(access, layout, { heightMeters: 4.5 });
  const p = modelPointToWorld(model.frame, [3, 2, 7]);
  close(p[0], 109);
  close(p[1], 2);
  close(p[2], 108);
  assert.equal(model.heightMeters, 4.5);
  const north = createFootprint3D({ ...access, headingDegrees: 0 }, layout);
  const q = modelPointToWorld(north.frame, [3, 2, 7]);
  close(q[0], 105);
  close(q[1], 2);
  close(q[2], 98);
});

test("missing frame retains the outline and invalid inputs fail closed", () => {
  const publicAccess = {
    footprint: { outer: access.footprint.outer, holes: access.footprint.holes },
  };
  const model = createFootprint3D(publicAccess, layout);
  assert.equal(model.rings.length, 2);
  assert.equal(model.frame, null);
  assert.equal(modelPointToWorld(null, [0, 0, 0]), null);
  assert.equal(createFootprint3D(null, layout), null);
  assert.equal(
    createFootprint3D(
      {
        footprint: {
          ...access.footprint,
          outer: access.footprint.outer.slice(0, -1),
        },
      },
      layout,
    ),
    null,
  );
  assert.equal(
    createFootprint3D(
      { footprint: { ...access.footprint, holes: [access.footprint.outer] } },
      layout,
    ),
    null,
  );
  assert.equal(createFootprint3D(access, {}, {}), null);
  for (const heightMeters of [0, -1, NaN, Infinity, "4"])
    assert.equal(createFootprint3D(access, layout, { heightMeters }), null);
});
