// Synthetic rendering geometry only; inputs carry no review or site status.
// Local coordinates are [right, forward] in metres. At bearing 0, right is
// east (+X) and forward is north (-Z); bearing increases clockwise.
// The pivot is a local coordinate mapped exactly to anchor [world X, world Z].
export function measuredStructureGeometry({ anchor, bearingDegrees, pivot, dimensions, height } = {}) {
  const pair = (v) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite);
  if (!pair(anchor) || !pair(pivot) || !Number.isFinite(bearingDegrees))
    throw new TypeError("Invalid anchor, pivot or bearing");
  const { width, depth, cutoutWidth, cutoutDepth } = dimensions || {};
  if (![width, depth, cutoutWidth, cutoutDepth].every(Number.isFinite) ||
      width <= 0 || depth <= 0 || cutoutWidth <= 0 || cutoutWidth >= width ||
      cutoutDepth <= 0 || cutoutDepth >= depth)
    throw new TypeError("Invalid metre dimensions");
  if (height !== null && (!Number.isFinite(height) || height <= 0))
    throw new TypeError("Height must be a positive metre value or null when unknown");

  // Remove the far-right corner of the width-by-depth rectangle.
  const local = [[0, 0], [width, 0], [width, depth - cutoutDepth],
    [width - cutoutWidth, depth - cutoutDepth], [width - cutoutWidth, depth], [0, depth]];
  const angle = ((bearingDegrees % 360) * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const footprint = local.map(([right, forward]) => {
    const x = right - pivot[0], f = forward - pivot[1];
    return [anchor[0] + x * cos + f * sin, anchor[1] + x * sin - f * cos];
  });
  return { footprint, height };
}

// Public records are accepted only in the {id, kind, published} envelope.
// The supplied footprint already defines placement; frame metadata is checked
// but does not rotate or resize it, and model metadata never loads an asset.
import * as THREE from "three";
import { publicStructureSchema } from "./structure.mjs";
import { geographicToPlan } from "./geography.mjs";
import { createFootprint3D } from "./footprint3d.mjs";

export function preparePublicStructure(record, layout) {
  if (typeof record?.id !== "string" || !record.id.trim() || record.kind !== "structure") return null;
  const parsed = publicStructureSchema.safeParse(record.published);
  if (!parsed.success) return null;
  const structure = parsed.data;
  try {
    // Reject incompatible layout regions before attempting UTM projection.
    geographicToPlan(structure.frame.physicalAnchor, layout, { enforceBounds: true });
    for (const ring of [structure.footprint.outer, ...structure.footprint.holes])
      for (const [lon, lat] of ring)
        geographicToPlan({ lon, lat }, layout, { enforceBounds: true });
    const footprint = createFootprint3D({ footprint: structure.footprint }, layout);
    if (!footprint) return null;
    return {
      rings: footprint.rings.map((ring) => ring.map(([x, , z]) => [x, z])),
      height: structure.height === null ? null : structure.height.metres,
    };
  } catch {
    return null;
  }
}

// Geometry is built in XY with extrusion along local +Z. The component rotates
// it to world X/Z with extrusion along world +Y. Caller owns and disposes it.
export function createStructureMeshGeometry({ rings, height }) {
  const trace = (path, ring) => {
    ring.forEach(([x, z], index) => index ? path.lineTo(x, -z) : path.moveTo(x, -z));
    path.closePath();
    return path;
  };
  const shape = trace(new THREE.Shape(), rings[0]);
  shape.holes = rings.slice(1).map((ring) => trace(new THREE.Path(), ring));
  return height === null
    ? new THREE.ShapeGeometry(shape)
    : new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
}
