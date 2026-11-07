import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  ownerAmenityReferences,
  referenceContains,
  areaRing,
  pointInRing,
  previewAmenity,
  amenityClipBridges,
  sharedAmenityPosition,
  OWNER_AMENITY_SOURCE,
} from "../shared/owner-amenity-references.mjs";
import { planToGeographic, geographicToPlan } from "../server/geometry.mjs";
const layout = JSON.parse(await readFile("public/data/layout.json", "utf8"));
const originals = {
  "fountain.png":
    "f3c1abbaeede2c59c080a7178c655c5839e8abd44d9037ffdb3fa39002386213",
  "temple.png":
    "51cd0bb4959572593ddff2f7b8ed2f919f5e28cb252687ea2cb242c75c47508f",
  "garden.png":
    "cea430d0206d53da79619e4cd42ba321efd403f0c17c004c5502ee14ae84ed9d",
  "club-house.png":
    "5963128274fabfde46085d9cace85486ff05c5017e5fcdfc5a7c9185954daafb",
  "entry-gate.png":
    "1d67305ece54067191ccb532c044e7ff92dad51ed2cc86f5996fa98b10958e6e",
};
test("shared amenity placement rotates and scales in map coordinates", () => {
  const input = { x: 12, y: 21, visualScale: 0.5, visualRotation: 10 };
  const shared = { x: 50, y: 70, visualScale: 2, visualRotation: 90 };
  const position = sharedAmenityPosition(input, shared, { x: 10, y: 20 });
  assert.ok(Math.abs(position.x - 48) < 1e-9);
  assert.ok(Math.abs(position.y - 74) < 1e-9);
  assert.equal(position.rotation, 100);
  assert.equal(position.scale, 1);
  assert.deepEqual(input, {
    x: 12,
    y: 21,
    visualScale: 0.5,
    visualRotation: 10,
  });
});
test("owner leisure references and separate public images remain intact", async () => {
  const hashes = {
    "outdoor-gym-concept.png":
      "97e8d35146f764466ae808e9c8a11b3e39e50386897ce10108f531690311fd08",
    "clubhouse-pool-gym-concept.png":
      "9242669efd64ba85eb9f13b9acba49335e95accca2142272b42370498a374fdf",
    "pool-concept.png":
      "48d40f08115ba52f56f9bed938a43347fb5f72e9b6f2009ec881ee6b06c5d5b7",
  };
  for (const [name, hash] of Object.entries(hashes)) {
    const source = await readFile(`source-data/${name}`);
    assert.equal(createHash("sha256").update(source).digest("hex"), hash);
    if (name.startsWith("clubhouse-")) continue;
    assert.deepEqual(await readFile(`public/assets/concepts/${name}`), source);
    const optimized = await readFile(
      `public/assets/concepts/${name.replace(/\.png$/, "-map.webp")}`,
    );
    assert.equal(optimized.toString("ascii", 8, 12), "WEBP");
    assert.ok(optimized.length < 150_000);
  }
});
test("owner-indicated anchors remain within their source areas and outside plot interiors", () => {
  assert.equal(
    new Set(ownerAmenityReferences.map((item) => item.id)).size,
    ownerAmenityReferences.length,
  );
  for (const id of ["owner-ref-clubhouse", "owner-ref-pool", "owner-ref-gym"])
    assert.ok(ownerAmenityReferences.some((item) => item.id === id));
  for (const ref of ownerAmenityReferences) {
    assert.equal(referenceContains(layout, ref, ref.mapPoint), true, ref.id);
    const roundTrip = geographicToPlan(planToGeographic(ref.mapPoint));
    assert.equal(
      referenceContains(layout, ref, roundTrip),
      true,
      `${ref.id} roundtrip`,
    );
    assert.ok(
      Math.hypot(roundTrip.x - ref.mapPoint.x, roundTrip.y - ref.mapPoint.y) <
        0.02,
    );
    assert.equal(
      layout.plots.some((plot) =>
        pointInRing([ref.mapPoint.x, ref.mapPoint.y], areaRing(plot.path)),
      ),
      false,
      `${ref.id} intersects plot`,
    );
    const preview = previewAmenity(ref);
    assert.equal(preview.source, ref.source || OWNER_AMENITY_SOURCE);
    assert.equal(preview.placementPrecision, "approximate");
    assert.equal(preview.state, ref.state || "confirmation_pending");
    assert.equal(preview.imageKind, "concept");
  }
  assert.deepEqual(
    ownerAmenityReferences.find((r) => r.category === "fountain").areaIds,
    ["area-30"],
  );
  assert.deepEqual(
    ownerAmenityReferences.find((r) => r.category === "entrance").areaIds,
    ["area-31"],
  );
});
test("owner concept originals are unchanged and public copies are byte-identical", async () => {
  for (const [name, expected] of Object.entries(originals)) {
    const original = await readFile(name),
      copy = await readFile(`public/assets/concepts/${name}`);
    assert.equal(
      createHash("sha256").update(original).digest("hex"),
      expected,
      name,
    );
    assert.deepEqual(copy, original, name);
  }
});
test("new concept and texture originals are unchanged; displayed source copies are exact", async () => {
  const hashes = {
    "garden-temple.png":
      "8aac50aca6722106ccd088778690cac0aeb49fc4a271c7cc72775708fd1d0fee",
    "houseclub.png":
      "bb6c45eedb955926f8598168ff108dc4bf908f56ac5a45a6b85fc1f52e586181",
    "entry--gate-new.png":
      "d17b8bb25cd9b1c7b706e5fc90cf40a6a52135bac5684c0ea3d550be835fdc51",
    "fountain-corner.png":
      "359cc215fbf762939dc8c2a4d3aa39351dd6819239fd8bae49ba307493440f36",
    "fountain-center.png":
      "1f43327cf3a9d35e537d6d78c9d50e6ebb7bf2befc60f94c6b87f8c5e3ffdc7b",
    "plot-grass.png":
      "a84cc389d3e2d90ab5d3d247bdf840033a6d2f9f11938045983fbb56962c51f1",
    "road-texture.png":
      "f0fa4bcb9c3cf1c805cce0ac747c5f2eec0f56b98ac956aaffebf59b2febe90e",
  };
  for (const [name, hash] of Object.entries(hashes)) {
    const original = await readFile(name);
    assert.equal(
      createHash("sha256").update(original).digest("hex"),
      hash,
      name,
    );
    if (
      [
        "garden-temple.png",
        "fountain-corner.png",
        "fountain-center.png",
      ].includes(name)
    )
      assert.deepEqual(
        await readFile(`public/assets/concepts/${name}`),
        original,
      );
  }
  for (const name of ["plot-grass", "road-texture"]) {
    const texture = await readFile(`public/assets/textures/${name}.webp`);
    assert.equal(texture.toString("ascii", 8, 12), "WEBP");
    assert.ok(texture.length < 150_000);
  }
});
test("four roundabout gardens have independent approved-area drafts and nonuniform angles", () => {
  const corners = ownerAmenityReferences.filter((item) =>
    item.id.startsWith("owner-ref-roundabout-garden-"),
  );
  assert.deepEqual(corners.map((item) => item.areaIds[0]).sort(), [
    "area-41",
    "area-42",
    "area-43",
    "area-44",
  ]);
  assert.equal(new Set(corners.map((item) => item.visualRotation)).size, 4);
  assert.ok(corners.every((item) => item.visualRotation % 90 !== 0));
  assert.ok(corners.every((item) => item.image === "fountain-corner.png"));
});
test("separate foregrounds retain transparency, proportions and compact web copies", async () => {
  for (const ref of ownerAmenityReferences.filter((item) => item.foreground)) {
    const item = ref.foreground;
    const png = await readFile(`public/assets/concepts/${item.image}`);
    const webp = await readFile(
      `public/assets/concepts/${item.image.replace(/\.png$/, "-map.webp")}`,
    );
    assert.equal(png[25], 6, `${ref.id} RGBA`);
    assert.equal(webp.toString("ascii", 8, 12), "WEBP");
    assert.ok(webp.length < 100_000);
    assert.ok(
      Math.abs(
        item.mapSize[0] / item.mapSize[1] -
          item.imageSize[0] / item.imageSize[1],
      ) < 0.01,
    );
  }
  const masterplan = await readFile(
    "source-data/owner-masterplan-concept-2026-11-02.png",
  );
  assert.equal(
    createHash("sha256").update(masterplan).digest("hex"),
    "73472a9cc38a38dadff565e60628aa24e36d4cdc7b8657afe5b887ee7028ee75",
  );
});
test("map concepts have compact WebP copies and practical projected sizes", async () => {
  for (const reference of ownerAmenityReferences.filter((item) => item.image)) {
    const optimized = await readFile(
      `public/assets/concepts/${reference.image.replace(/\.png$/, "-map.webp")}`,
    );
    assert.equal(optimized.toString("ascii", 0, 4), "RIFF");
    assert.equal(optimized.toString("ascii", 8, 12), "WEBP");
    assert.ok(optimized.length < 300_000, reference.id);
    assert.ok(
      reference.mapSize.every((dimension) => dimension > 0 && dimension <= 70),
    );
    const [x, y, width, height] = reference.mapCrop;
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0);
    assert.ok(
      x + width <= reference.imageSize[0] &&
        y + height <= reference.imageSize[1],
    );
  }
});
test("temple and garden artwork bridges only near-matching source edges", () => {
  const temple = ownerAmenityReferences.find(
    (reference) => reference.id === "owner-ref-temple",
  );
  const bridges = amenityClipBridges(layout, temple);
  assert.equal(bridges.length, 4);
  assert.ok(
    bridges.every((path) => path.startsWith("M") && path.endsWith(" Z")),
  );
  assert.deepEqual(amenityClipBridges(layout, ownerAmenityReferences[0]), []);
});
