import test from "node:test";
import assert from "node:assert/strict";
import { planToGeographic, stageGeometry } from "../server/geometry.mjs";

const polygon = (points, label = "fixture") => ({
  type: "Feature",
  properties: { label, block: "SYNTHETIC" },
  geometry: {
    type: "Polygon",
    coordinates: [
      points.map(([x, y]) => {
        const { lat, lon } = planToGeographic({ x, y });
        return [lon, lat];
      }),
    ],
  },
});
const box = (x, y, w, h) =>
  polygon([
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ]);
const input = (features) => ({
  sourceDocument: "Synthetic test only",
  sourceRevision: "test",
  reason: "Synthetic topology regression",
  features,
});
const outer = box(100, 100, 50, 50),
  inner = box(105, 105, 5, 5);
for (const [name, features] of [
  ["outer first", [outer, inner]],
  ["inner first", [inner, outer]],
  ["identical", [outer, outer]],
  ["aligned overlap", [outer, box(125, 100, 50, 50)]],
  ["partial crossing", [outer, box(125, 125, 50, 50)]],
])
  test(`staging rejects positive-area overlap: ${name} before any write`, async () => {
    let writes = 0;
    await assert.rejects(
      stageGeometry(
        {
          query: async () => {
            writes++;
            return { rows: [] };
          },
        },
        { id: "fixture" },
        input(features),
      ),
      /cells 1 and 2 overlap/,
    );
    assert.equal(writes, 0);
  });
for (const [name, second] of [
  ["shared edge", box(150, 100, 20, 50)],
  ["corner", box(150, 150, 20, 20)],
])
  test(`staging permits ${name}`, async () => {
    // Identical geographic shared vertices avoid introducing a rounding sliver.
    const result = await stageGeometry(
      { query: async () => ({ rows: [] }) },
      { id: "fixture" },
      input([outer, second]),
    );
    assert.equal(result.cells.length, 2);
    assert.deepEqual(result.cells[0].geographicGeometry, outer.geometry);
  });
for (const [name, feature] of [
  [
    "repeated vertex",
    polygon([
      [100, 100],
      [120, 100],
      [120, 120],
      [110, 110],
      [100, 120],
      [110, 110],
      [100, 100],
    ]),
  ],
  [
    "self crossing",
    polygon([
      [100, 100],
      [120, 120],
      [100, 120],
      [120, 100],
      [100, 100],
    ]),
  ],
  [
    "backtracking edge",
    polygon([
      [100, 100],
      [120, 100],
      [110, 100],
      [120, 120],
      [100, 120],
      [100, 100],
    ]),
  ],
])
  test(`staging rejects invalid ring: ${name} without writes`, async () => {
    let writes = 0;
    await assert.rejects(
      stageGeometry(
        {
          query: async () => {
            writes++;
            return { rows: [] };
          },
        },
        { id: "fixture" },
        input([feature]),
      ),
    );
    assert.equal(writes, 0);
  });
