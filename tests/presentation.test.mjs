import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  presentationFitsSource,
  presentationPlacementValid,
  presentationPlot,
} from "../shared/presentation.mjs";

const layout = JSON.parse(await readFile("public/data/layout.json", "utf8"));
const source = layout.plots.find((plot) => plot.label === "B26");
const plot = {
  ...source,
  id: "approved-test-id",
  geometryId: source.id,
  approved: {
    areaSqM: 100,
    dimensions: [{ name: "Reviewed side", metres: 10 }],
  },
};
const placement = {
  plotId: plot.id,
  geometryId: plot.geometryId,
  dx: 0,
  dy: 0,
  scale: 0.85,
  rotation: 0,
};

test("illustrative adjustments keep plot identity, status and source-backed measurements unchanged", () => {
  assert.equal(presentationFitsSource(source, placement), true);
  const display = presentationPlot(plot, placement);
  assert.notEqual(display.path, plot.path);
  assert.equal(display.id, plot.id);
  assert.equal(display.geometryId, plot.geometryId);
  assert.equal(display.status, plot.status);
  assert.deepEqual(display.approved, plot.approved);
  assert.equal(display.areaSqMApprox, plot.areaSqMApprox);
  assert.deepEqual(
    display.edges.map((edge) => edge.metres),
    plot.edges.map((edge) => edge.metres),
  );
  assert.deepEqual(
    presentationPlot(plot, { ...placement, geometryId: "outdated" }),
    plot,
  );
});
test("visual placement cannot escape the source polygon", () => {
  assert.equal(
    presentationFitsSource(source, { ...placement, dx: 3, scale: 1 }),
    false,
  );
  assert.equal(
    presentationFitsSource(source, { ...placement, scale: 1, dx: 0 }),
    true,
  );
  assert.equal(
    presentationFitsSource(source, { ...placement, dx: 0.2, scale: 0.8 }),
    true,
  );
});
test("owner-reviewed presentation may move beyond a source polygon while remaining in the scene", () => {
  const moved = { ...placement, dx: 3, scale: 1 };
  assert.equal(presentationFitsSource(source, moved), false);
  assert.equal(presentationPlacementValid(source, moved), true);
  assert.notEqual(presentationPlot(plot, moved).path, plot.path);
  assert.equal(presentationPlot(plot, moved).id, plot.id);
  assert.equal(
    presentationPlacementValid(source, { ...moved, dx: 101 }),
    false,
  );
  assert.equal(
    presentationPlacementValid(source, { ...moved, scale: 0 }),
    false,
  );
  assert.equal(
    presentationPlacementValid(
      { path: "M1,1 L2,2 L3,3 Z", center: [2, 2] },
      moved,
    ),
    false,
  );
});
test("both source B-series columns retain all 52 unverified draft identities", () => {
  for (let n = 1; n <= 26; n++) {
    const left = layout.plots.filter((p) => p.label === `B${n}`);
    const right = layout.plots.filter((p) => p.label === `B${53 - n}`);
    assert.equal(left.length, 1);
    assert.equal(right.length, 1);
    assert.notEqual(left[0].id, right[0].id);
    assert.ok(left[0].center[0] < right[0].center[0]);
    assert.ok(Math.abs(left[0].center[1] - right[0].center[1]) < 3);
    assert.equal(left[0].status, "unverified");
    assert.equal(right[0].status, "unverified");
  }
});
