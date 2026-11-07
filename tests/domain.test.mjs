import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseLength,
  metres,
  areaValue,
  areaLabel,
  contactSchema,
  filterPlots,
  dimensionLabels,
  approvedBlocks,
  blockLabels,
  plotLabels,
  can,
} from "../shared/domain.mjs";
const data = JSON.parse(
  fs.readFileSync(new URL("../public/data/layout.json", import.meta.url)),
);
const p = data.plots.find((p) => p.label === "B26");
test("feet/inches and metre parsing retain source units", () => {
  assert.equal(parseLength(`25'6"`), 25.5 * 0.3048);
  assert.equal(parseLength("6.7 m"), 6.7);
  assert.equal(parseLength("25′6″"), 25.5 * 0.3048);
  for (const invalid of ["25.6", "25'12\"", "6.7 × 13.72", "-4 m"])
    assert.throws(() => parseLength(invalid));
});
test("length and all area units use exact factors", () => {
  assert.equal(metres(0.3048, "ft"), 1);
  assert.equal(areaValue(0.09290304, "sqft"), 1);
  assert.equal(areaValue(0.83612736, "sqyd"), 1);
  assert.equal(areaValue(1, "sqm"), 1);
});
test("approximate and verified area cannot be confused", () => {
  assert.match(areaLabel(p), /^Approx\./);
  assert.match(areaLabel({ ...p, approved: { areaSqM: 100 } }), /^Verified/);
  assert.match(areaLabel(p, "sqm"), /120.9 m²/);
});
test("search, block, status, type, area and shortlist filters compose and sort naturally", () => {
  assert.equal(filterPlots(data.plots, { query: "B26" })[0].id, p.id);
  assert.equal(filterPlots(data.plots, { query: " b 26 " })[0].id, p.id);
  assert.equal(filterPlots(data.plots, { block: "PLOT 1" }).length, 52);
  assert.equal(filterPlots(data.plots, { status: "sold" }).length, 0);
  assert.equal(filterPlots(data.plots, { type: "residential" }).length, 0);
  assert.equal(
    filterPlots(data.plots, { savedOnly: true, saved: [p.id] }).length,
    1,
  );
  assert.ok(
    filterPlots(data.plots, { min: 100, max: 130 }).every(
      (p) => p.areaSqMApprox >= 100 && p.areaSqMApprox <= 130,
    ),
  );
  assert.equal(filterPlots(data.plots, { block: "PLOT 1" })[1].label, "B2");
});
test("only published owner-approved membership creates a block", () => {
  const other = data.plots.find((item) => item.id !== p.id);
  const published = {
    ...p,
    id: "approved",
    block: "B",
    publication: "published",
    approved: { number: "B26" },
  };
  const draft = { ...other, block: "B" };
  const unpublished = {
    ...other,
    id: "unpublished",
    block: "C",
    publication: "draft",
    approved: {},
  };
  const blocks = approvedBlocks([draft, unpublished, published]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].name, "B");
  assert.deepEqual(
    blocks[0].plots.map((item) => item.id),
    ["approved"],
  );
  assert.deepEqual(
    filterPlots([draft, published], { approvedBlock: "B" }).map(
      (item) => item.id,
    ),
    ["approved"],
  );
});
test("plot labels keep a 13px minimum, prioritize selection and avoid overlap", () => {
  const overlapping = {
    ...p,
    id: "overlap",
    center: [...p.center],
    label: "B27",
  };
  const view = [p.center[0] - 20, p.center[1] - 20, 40, 40];
  const labels = plotLabels([overlapping, p], p.id, view, 8);
  assert.deepEqual(
    labels.map((item) => item.id),
    [p.id],
  );
  assert.deepEqual(
    plotLabels([p], p.id, view, 8, false).map((item) => item.id),
    [p.id],
  );
  assert.deepEqual(plotLabels([p], null, [0, 0, 1, 1], 1), []);
});
test("overview block labels do not overlap and only use approved groups", () => {
  const blocks = [
    { name: "B", bounds: [10, 10, 20, 20] },
    { name: "C", bounds: [10, 10, 20, 20] },
    { name: "D", bounds: [60, 60, 80, 80] },
  ];
  assert.deepEqual(
    blockLabels(blocks, [0, 0, 100, 100], 3).map((b) => b.name),
    ["B", "D"],
  );
});
test("dimension labels declutter at low zoom, keep upright and mark approximations", () => {
  assert.equal(dimensionLabels(p, 0.2).length, 0);
  const labels = dimensionLabels(p, 10);
  assert.ok(labels.length >= 2);
  for (const d of labels) {
    assert.match(d.label, /Approx\./);
    assert.ok(d.angle >= -90 && d.angle <= 90);
  }
  const verified = {
    ...p,
    approved: { dimensions: [{ edgeIndex: 0, metres: 10 }] },
  };
  assert.ok(
    dimensionLabels(verified, 10).some((d) => d.label.startsWith("Verified")),
  );
});
test("form schemas reject missing consent, malformed phones and markup", () => {
  const body = { name: "Test Person", phone: "+91 9000000000", consent: true };
  assert.equal(contactSchema.safeParse(body).success, true);
  for (const patch of [
    { consent: false },
    { phone: "123" },
    { name: "<script>" },
    { website: "spam" },
    { email: "bad" },
  ])
    assert.equal(contactSchema.safeParse({ ...body, ...patch }).success, false);
  assert.equal(
    contactSchema.safeParse({ ...body, preferredContact: "email" }).success,
    false,
  );
  assert.equal(
    contactSchema.safeParse({
      ...body,
      preferredContact: "email",
      email: "buyer@example.invalid",
    }).success,
    true,
  );
});
test("role matrix grants public no operations and separates review, sales and publication", () => {
  assert.equal(can("public", "inventory"), false);
  assert.equal(can("sales", "publish"), false);
  assert.equal(can("reviewer", "leads"), false);
  assert.equal(can("viewer", "audit"), true);
  assert.equal(can("owner", "access"), true);
});
test("all source warnings, CSV review rows and source identity anomalies are preserved", () => {
  const geo = JSON.parse(
    fs.readFileSync("public/data/reconstructed-cells.geojson"),
  );
  assert.ok(geo.features.every((p) => p.properties.reviewRequired));
  assert.equal(data.plots.filter((p) => p.identityReviewRequired).length, 32);
  assert.ok(data.plots.some((p) => p.block === "PLOY 17"));
  assert.equal(data.plots.filter((p) => p.block === "PLOT 16").length, 1);
  assert.ok(
    data.plots.every((p) => p.geometrySource.includes("owner review required")),
  );
});
test("manual split/merge geometry derives approximate UTM measurements and rejects unsafe rings", async () => {
  const { deriveCell } = await import("../server/geometry.mjs");
  const geo = JSON.parse(
    fs.readFileSync("public/data/reconstructed-cells.geojson"),
  );
  const f = geo.features.find((f) => f.properties.id === p.id);
  const cell = deriveCell(f, "test");
  assert.ok(Math.abs(cell.areaSqMApprox - p.areaSqMApprox) < 0.1);
  assert.equal(cell.reviewRequired, true);
  assert.equal(cell.identityReviewRequired, true);
  assert.throws(
    () =>
      deriveCell(
        {
          ...f,
          geometry: {
            type: "Polygon",
            coordinates: [f.geometry.coordinates[0].slice(1)],
          },
        },
        "bad",
      ),
    /Close/,
  );
});
