import test from "node:test";
import assert from "node:assert/strict";
import {
  validateFootprint,
  placeFootprint,
  assessFootprint,
} from "../shared/footprint.mjs";
const square = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];
// Synthetic coordinates only, with no real-world provenance.
const f = {
  outer: square(0, 0, 10, 10),
  holes: [square(3, 3, 2, 2)],
  interactions: [
    {
      type: "road",
      id: "road",
      segment: [
        [2, -5],
        [2, 5],
      ],
    },
    { type: "gate", id: "gate", roadId: "road", point: [2, 0] },
  ],
};
test("closed simple topology and crossing road are valid without modifying source", () => {
  const original = structuredClone(f);
  const result = validateFootprint(f);
  assert.equal(result.valid, true);
  assert.deepEqual(f, original);
  assert.equal(
    validateFootprint({ ...f, outer: f.outer.slice(0, -1) }).valid,
    false,
  );
  assert.equal(
    validateFootprint({ ...f, holes: [f.holes[0].slice(0, -1)] }).valid,
    false,
  );
  for (const bad of [
    {
      ...f,
      outer: [
        [0, 0],
        [10, 10],
        [0, 10],
        [10, 0],
        [0, 0],
      ],
    },
    {
      ...f,
      outer: [
        [0, 0],
        [10, 0],
        [5, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    },
    { ...f, holes: [square(0, 2, 2, 2)] },
    { ...f, holes: [square(1, 1, 7, 7), square(2, 2, 1, 1)] },
    { ...f, holes: [square(1, 1, 2, 2), square(3, 3, 1, 1)] },
    {
      ...f,
      interactions: [
        { type: "gate", id: "gate", roadId: "missing", point: [2, 0] },
      ],
    },
    {
      ...f,
      interactions: [
        {
          type: "road",
          id: "road",
          segment: [
            [2, -5],
            [2, 5],
          ],
        },
        { type: "gate", id: "gate", roadId: "road", point: [3, 0] },
      ],
    },
  ])
    assert.equal(validateFootprint(bad).valid, false);
});
test("rigid placement preserves dimensions and transforms interactions", () => {
  const before = structuredClone(f);
  const result = placeFootprint(
    f,
    { anchor: [0, 0], headingDegrees: 0 },
    { anchor: [100, 200], headingDegrees: 90 },
  );
  assert.deepEqual(result.outer[0], [100, 200]);
  assert.ok(Math.abs(result.outer[1][1] - 210) < 1e-9);
  assert.deepEqual(result.interactions[1].point, [100, 202]);
  assert.deepEqual(f, before);
  assert.throws(
    () =>
      placeFootprint(
        f,
        { anchor: [0, 0], headingDegrees: 360 },
        { anchor: [0, 0], headingDegrees: 0 },
      ),
    RangeError,
  );
});
test("assesses bounds, overlap, holes and explicit gate/road boundary contact", () => {
  const options = {
    bounds: [-1, -1, 11, 11],
    polygons: [
      { id: "overlap", outer: square(9, 1, 3, 3), holes: [] },
      { id: "hole", outer: square(3.5, 3.5, 1, 1), holes: [] },
      {
        id: "contact",
        outer: square(0, -2, 4, 2),
        holes: [],
        allowedInteractions: ["gate"],
      },
    ],
  };
  const result = assessFootprint(f, options);
  assert.equal(result.withinBounds, true);
  assert.deepEqual(
    result.overlaps.map((x) => x.id),
    ["overlap"],
  );
  assert.ok(Math.abs(result.overlaps[0].area - 3) < 1e-9);
  assert.equal(result.contacts.find((x) => x.id === "contact").allowed, false);
  assert.ok(result.warnings.some((x) => x.includes("road")));
  const contact = {
    ...f,
    interactions: [
      {
        type: "road",
        id: "road",
        segment: [
          [0, 0],
          [4, 0],
        ],
      },
      { type: "gate", id: "gate", roadId: "road", point: [2, 0] },
    ],
  };
  assert.equal(
    assessFootprint(contact, {
      ...options,
      polygons: [{ ...options.polygons[2], allowedInteractions: ["road"] }],
    }).contacts[0].allowed,
    true,
  );
  assert.equal(
    assessFootprint(f, { bounds: [0, 0, 9, 10], polygons: [] }).withinBounds,
    false,
  );
  assert.throws(
    () =>
      assessFootprint(f, {
        bounds: [0, 0, 10, 10],
        polygons: [
          {
            id: "bad",
            outer: [
              [0, 0],
              [1, 0],
              [0, 1],
            ],
            holes: [],
          },
        ],
      }),
    RangeError,
  );
});
