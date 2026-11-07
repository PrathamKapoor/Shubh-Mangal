import sourceLayout from "../public/data/layout.json" with { type: "json" };
import {
  geographicToPlan as projectToPlan,
  planToGeographic as projectToGeographic,
} from "../shared/geography.mjs";
import polygonClipping from "polygon-clipping";
import { z } from "zod";
import { hash, audit } from "./auth.mjs";
import { HttpError } from "./inventory.mjs";
const coordinate = z.tuple([
  z.number().min(74.9).max(74.92),
  z.number().min(24.46).max(24.48),
]);
export const revisionSchema = z
  .object({
    sourceDocument: z.string().min(5).max(200),
    sourceRevision: z.string().min(1).max(100),
    reason: z.string().min(8).max(1000),
    features: z
      .array(
        z
          .object({
            type: z.literal("Feature"),
            properties: z
              .object({
                label: z.string().min(1).max(50),
                block: z.string().min(1).max(80),
              })
              .strict(),
            geometry: z
              .object({
                type: z.literal("Polygon"),
                coordinates: z
                  .array(z.array(coordinate).min(4).max(100))
                  .length(1),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export function geographicToPlan(point, layout = sourceLayout) {
  return projectToPlan(point, layout);
}
export function planToGeographic(point, layout = sourceLayout) {
  const { lat, lon } = projectToGeographic(point, layout);
  return { lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)) };
}
const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function crosses(a, b, c, d) {
  return (
    cross(a, b, c) * cross(a, b, d) < -1e-8 &&
    cross(c, d, a) * cross(c, d, b) < -1e-8
  );
}
const onSegment = (p, a, b) =>
  Math.abs(cross(a, b, p)) <= 1e-9 &&
  p[0] >= Math.min(a[0], b[0]) &&
  p[0] <= Math.max(a[0], b[0]) &&
  p[1] >= Math.min(a[1], b[1]) &&
  p[1] <= Math.max(a[1], b[1]);
function touches(a, b, c, d) {
  return (
    crosses(a, b, c, d) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b)
  );
}
// A micrometre grid stabilises floating point projection noise, not survey error.
// Intersection area is then tested strictly positive in local square metres.
function clippingRing(cell) {
  return cell.edges.map(({ a }) => a.map((v) => Math.round(v * 1e6) / 1e6));
}
function inside(p, ring) {
  let yes = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
export function deriveCell(feature, id, layout = sourceLayout) {
  const ring = feature.geometry.coordinates[0];
  if (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])
    throw new HttpError(422, "Close each polygon ring explicitly");
  const points = ring.map((p) => {
    const { x, y } = projectToPlan({ lon: p[0], lat: p[1] }, layout);
    return [x, y];
  });
  if (
    new Set(points.slice(0, -1).map((p) => p.join(","))).size !==
    points.length - 1
  )
    throw new HttpError(422, "Repeated polygon vertices require correction");
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      c = points[(i + 2) % (points.length - 1)];
    if (
      Math.abs(cross(a, b, c)) <= 1e-9 &&
      (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) < 0
    )
      throw new HttpError(422, "Backtracking polygon edges require correction");
    if (
      Math.hypot(
        points[i][0] - points[i + 1][0],
        points[i][1] - points[i + 1][1],
      ) < 0.05
    )
      throw new HttpError(422, "Remove zero-length or sub-5cm edges");
    for (let j = i + 2; j < points.length - 1; j++) {
      if (i === 0 && j === points.length - 2) continue;
      if (touches(points[i], points[i + 1], points[j], points[j + 1]))
        throw new HttpError(422, "Self-crossing polygons require correction");
    }
  }
  let twiceArea = 0,
    cx = 0,
    cy = 0;
  const edges = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1],
      c = a[0] * b[1] - b[0] * a[1];
    twiceArea += c;
    cx += (a[0] + b[0]) * c;
    cy += (a[1] + b[1]) * c;
    const metres = Math.hypot(a[0] - b[0], a[1] - b[1]);
    edges.push({ a, b, metres, feet: metres / 0.3048 });
  }
  if (Math.abs(twiceArea) / 2 < 1)
    throw new HttpError(422, "Polygon area must be at least 1 m²");
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  let center = [cx / (3 * twiceArea), cy / (3 * twiceArea)];
  if (!inside(center, points)) center = points[0];
  return {
    id,
    label: feature.properties.label,
    block: feature.properties.block,
    path: `M${points.map((p) => p.join(",")).join(" L")} Z`,
    center,
    bounds: [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ],
    edges,
    areaSqMApprox: Math.abs(twiceArea) / 2,
    identityReviewRequired: true,
    labelCandidates: [feature.properties.label],
    status: "unverified",
    verifiedDimensions: null,
    geometrySource:
      "Manually proposed source revision; projected UTM 43N; owner and topology review required",
    reviewRequired: true,
  };
}
export async function stageGeometry(tx, user, input) {
  const revision = revisionSchema.parse(input),
    digest = hash(JSON.stringify(revision)),
    id = `revision-${digest}`;
  const cells = revision.features.map((f, i) => {
    try {
      return deriveCell(f, `${id}-cell-${i + 1}`);
    } catch (error) {
      if (error instanceof HttpError)
        error.message = `Feature ${i + 1}: ${error.message}`;
      throw error;
    }
  });
  // Overlaps must be reconciled deliberately; no automatic split/merge of existing inventory.
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      if (
        polygonClipping.intersection(
          [clippingRing(cells[i])],
          [clippingRing(cells[j])],
        ).length > 0
      )
        throw new HttpError(
          422,
          `Proposed cells ${i + 1} and ${j + 1} overlap; reconcile topology before staging`,
        );
    }
  await tx.query(
    "INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [
      id,
      digest,
      JSON.stringify({
        ...revision,
        features: undefined,
        actor: user.id,
        reviewRequired: true,
      }),
    ],
  );
  for (const cell of cells)
    await tx.query(
      "INSERT INTO draft_cells(id,revision_id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [cell.id, id, JSON.stringify(cell)],
    );
  await audit(
    tx,
    user,
    "geometry.stage",
    id,
    null,
    {
      cells: cells.map((c) => c.id),
      sourceDocument: revision.sourceDocument,
      sourceRevision: revision.sourceRevision,
    },
    revision.reason,
  );
  return {
    revisionId: id,
    cells,
    publication: "draft",
    warning:
      "Topology against other source revisions, gaps and overlaps still require manual review. No existing mapping changed.",
  };
}
