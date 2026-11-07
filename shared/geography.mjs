import proj4 from "proj4";
import { ringsFromPath, classifyRings } from "./scene3d.mjs";

function geographicPoint(point) {
  if (
    !Number.isFinite(point?.lat) ||
    !Number.isFinite(point?.lon) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lon) > 180
  )
    throw new RangeError(
      "Expected finite geographic { lat, lon } in global bounds",
    );
  return point;
}

// Layout offsets and plan coordinates are metres; geographic coordinates are
// always WGS84. Older layouts omit datum/units, which retain those meanings.
export function projectionFromLayout(layout) {
  const origin = layout?.origin;
  const zone =
    typeof origin?.utmZone === "string"
      ? /^([1-9]|[1-5]\d|60)([NS])$/.exec(origin.utmZone)
      : null;
  const bounds = layout?.geographicBounds;
  if (
    !zone ||
    !Number.isFinite(origin.easting) ||
    !Number.isFinite(origin.northingTop) ||
    origin.easting < 100000 ||
    origin.easting > 900000 ||
    origin.northingTop < 0 ||
    origin.northingTop > 10000000 ||
    (origin.datum !== undefined && origin.datum !== "WGS84") ||
    (origin.units !== undefined && origin.units !== "m") ||
    (layout.datum !== undefined && layout.datum !== "WGS84") ||
    (layout.units !== undefined && layout.units !== "m") ||
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite)
  )
    throw new RangeError(
      "Invalid layout UTM origin, WGS84 datum, metre units or geographic bounds",
    );
  const [west, south, east, north] = bounds;
  const centralMeridian = Number(zone[1]) * 6 - 183;
  if (
    west < -180 ||
    east > 180 ||
    south < -80 ||
    north > 84 ||
    west >= east ||
    south >= north ||
    Math.abs((west + east) / 2 - centralMeridian) > 3 ||
    (zone[2] === "N" ? south < 0 : north > 0)
  )
    throw new RangeError(
      "Invalid geographic bounds for layout UTM zone/hemisphere",
    );
  return `+proj=utm +zone=${zone[1]}${zone[2] === "S" ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
}

// Offsite positions are allowed by default. Callers can explicitly enforce the
// layout extent without confusing that extent with their own placement policy.
export function geographicToPlan(
  point,
  layout,
  { enforceBounds = false } = {},
) {
  geographicPoint(point);
  const projection = projectionFromLayout(layout);
  if (enforceBounds) {
    const [west, south, east, north] = layout.geographicBounds;
    // Source bounds are rounded to six decimals; paths to three metre decimals.
    const tolerance = 5.1e-7;
    if (
      point.lon < west - tolerance ||
      point.lon > east + tolerance ||
      point.lat < south - tolerance ||
      point.lat > north + tolerance
    )
      throw new RangeError("Geographic point outside layout bounds");
  }
  const [east, north] = proj4("EPSG:4326", projection, [point.lon, point.lat]);
  const result = {
    x: east - layout.origin.easting,
    y: layout.origin.northingTop - north,
  };
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y))
    throw new RangeError(
      "Geographic point cannot be projected to finite plan coordinates",
    );
  return result;
}

export function planToGeographic(point, layout) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y))
    throw new RangeError("Expected finite plan { x, y }");
  const projection = projectionFromLayout(layout);
  const [lon, lat] = proj4(projection, "EPSG:4326", [
    layout.origin.easting + point.x,
    layout.origin.northingTop - point.y,
  ]);
  return geographicPoint({ lat, lon });
}

// Google positions may be offsite and require no plan layout or UTM projection.
export function toGooglePosition(point) {
  const { lat, lon } = geographicPoint(point);
  return { lat, lng: lon };
}

function geographicRing(ring, layout, outer) {
  const coordinates = ring.map(([x, y]) => {
    const { lat, lon } = planToGeographic({ x, y }, layout);
    return [lon, lat];
  });
  // Translate before summing to avoid cancellation at geographic magnitudes.
  const [ox, oy] = coordinates[0];
  const area = coordinates.reduce((sum, [x, y], i) => {
    const [nx, ny] = coordinates[(i + 1) % coordinates.length];
    return sum + (x - ox) * (ny - oy) - (nx - ox) * (y - oy);
  }, 0);
  if (!Number.isFinite(area) || area === 0)
    throw new RangeError("Invalid geographic ring");
  if (area > 0 !== outer) coordinates.reverse();
  coordinates.push([...coordinates[0]]);
  return coordinates;
}

export function pathToGeographicGeometry(path, layout) {
  try {
    projectionFromLayout(layout);
    if (typeof path !== "string") return null;
    const count = (path.match(/[Mm]/g) || []).length;
    // The shared parser accepts open SVG fills and skips degenerate contours;
    // geographic polygons must be explicitly closed and retain every contour.
    if (
      !count ||
      (path.match(/[Zz]/g) || []).length !== count ||
      !/[Zz]\s*$/.test(path)
    )
      return null;
    const rings = ringsFromPath(path);
    if (rings.length !== count) return null;
    const groups = classifyRings(rings);
    if (
      groups.reduce((sum, group) => sum + 1 + group.holes.length, 0) !== count
    )
      return null;
    const coordinates = groups.map((group) => [
      geographicRing(group.outer, layout, true),
      ...group.holes.map((hole) => geographicRing(hole, layout, false)),
    ]);
    return coordinates.length === 1
      ? { type: "Polygon", coordinates: coordinates[0] }
      : { type: "MultiPolygon", coordinates };
  } catch {
    return null;
  }
}
