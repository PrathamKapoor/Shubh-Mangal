import { geographicToPlan } from "./geography.mjs";
import { validateFootprint } from "./footprint.mjs";
import { toWorld } from "./scene3d.mjs";

// The input is a reviewed access payload, not an admin draft. Its footprint
// coordinates are [longitude, latitude]. Public payloads omit provenance.
// Optional heightMeters is an explicitly supplied measurement; omission means
// unknown, not zero. This helper never infers a height from the footprint.
export function createFootprint3D(
  access,
  layout,
  { heightMeters = null } = {},
) {
  if (
    heightMeters !== null &&
    (!Number.isFinite(heightMeters) || heightMeters <= 0)
  )
    return null;
  const footprint = access?.footprint;
  if (
    !footprint ||
    (footprint.datum !== undefined && footprint.datum !== "WGS84") ||
    !Array.isArray(footprint.outer) ||
    !Array.isArray(footprint.holes)
  )
    return null;
  try {
    const project = (point) => {
      if (!Array.isArray(point) || point.length !== 2)
        throw new RangeError("Invalid coordinate");
      const { x, y } = geographicToPlan(
        { lon: point[0], lat: point[1] },
        layout,
      );
      return [x, y];
    };
    const outer = footprint.outer.map(project);
    const holes = footprint.holes.map((ring) => ring.map(project));
    if (!validateFootprint({ outer, holes, interactions: [] }).valid)
      return null;
    let frame = null;
    if (
      access.physicalAnchor &&
      Number.isFinite(access.headingDegrees) &&
      access.headingDegrees >= 0 &&
      access.headingDegrees < 360
    ) {
      const { x, y } = geographicToPlan(access.physicalAnchor, layout);
      frame = {
        anchor: toWorld([x, y]),
        headingDegrees: access.headingDegrees,
      };
    }
    return {
      rings: [outer, ...holes].map((ring) =>
        ring.slice(0, -1).map((p) => toWorld(p)),
      ),
      frame,
      heightMeters,
    };
  } catch {
    return null;
  }
}

// Local coordinates are [right, up, forward] in metres. Heading is clockwise
// from north; Three world uses +X east, +Y up and +Z south. No scaling/inset.
export function modelPointToWorld(frame, point) {
  if (
    !Array.isArray(frame?.anchor) ||
    frame.anchor.length !== 3 ||
    !frame.anchor.every(Number.isFinite) ||
    !Number.isFinite(frame.headingDegrees) ||
    frame.headingDegrees < 0 ||
    frame.headingDegrees >= 360 ||
    !Array.isArray(point) ||
    point.length !== 3 ||
    !point.every(Number.isFinite)
  )
    return null;
  const angle = (frame.headingDegrees * Math.PI) / 180;
  const [right, up, forward] = point;
  const result = [
    frame.anchor[0] + right * Math.cos(angle) + forward * Math.sin(angle),
    frame.anchor[1] + up,
    frame.anchor[2] + right * Math.sin(angle) - forward * Math.cos(angle),
  ];
  return result.every(Number.isFinite) ? result : null;
}
