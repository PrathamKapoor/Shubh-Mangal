// Standalone planar geometry in metres: +x east, +y south. This module does
// not verify measurements, provenance, ownership, publication or site access.
import polygonClipping from "polygon-clipping";
// Numerical predicate guard only; this is not a measurement or survey tolerance.
const EPS = 1e-9;
const point = (p) =>
  Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const on = (p, a, b) =>
  Math.abs(cross(a, b, p)) <= EPS &&
  p[0] >= Math.min(a[0], b[0]) - EPS &&
  p[0] <= Math.max(a[0], b[0]) + EPS &&
  p[1] >= Math.min(a[1], b[1]) - EPS &&
  p[1] <= Math.max(a[1], b[1]) + EPS;
function intersects(a, b, c, d) {
  const x = cross(a, b, c),
    y = cross(a, b, d),
    z = cross(c, d, a),
    w = cross(c, d, b);
  return (
    (((x > EPS && y < -EPS) || (x < -EPS && y > EPS)) &&
      ((z > EPS && w < -EPS) || (z < -EPS && w > EPS))) ||
    on(c, a, b) ||
    on(d, a, b) ||
    on(a, c, d) ||
    on(b, c, d)
  );
}
function edges(r) {
  return r.map((p, i) => [p, r[(i + 1) % r.length]]);
}
function ring(input) {
  if (
    !Array.isArray(input) ||
    input.length < 4 ||
    !input.every(point) ||
    !same(input[0], input.at(-1))
  )
    return null;
  const r = input.map((p) => [...p]);
  if (r.length > 1 && same(r[0], r.at(-1))) r.pop();
  if (r.length < 3 || new Set(r.map((p) => p.join(","))).size !== r.length)
    return null;
  let area = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i],
      b = r[(i + 1) % r.length],
      c = r[(i + 2) % r.length];
    // Adjacent edges may meet only at their common endpoint, never double back.
    if (Math.abs(cross(a, b, c)) <= EPS && (on(c, a, b) || on(a, b, c)))
      return null;
    area +=
      (a[0] - r[0][0]) * (b[1] - r[0][1]) - (b[0] - r[0][0]) * (a[1] - r[0][1]);
    for (let j = i + 1; j < r.length; j++) {
      if (j === i + 1 || (i === 0 && j === r.length - 1)) continue;
      if (intersects(a, b, r[j], r[(j + 1) % r.length])) return null;
    }
  }
  return Number.isFinite(area) && Math.abs(area) > EPS ? r : null;
}
function inside(p, r) {
  let yes = false;
  for (const [a, b] of edges(r)) {
    if (on(p, a, b)) return false;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1])
    )
      yes = !yes;
  }
  return yes;
}
const touches = (a, b) =>
  edges(a).some(([p, q]) => edges(b).some(([r, s]) => intersects(p, q, r, s)));

// outer and holes are explicitly closed simple rings; holes must be strictly
// inside the outer ring and mutually disjoint, including their boundaries.
// A road may cross the footprint; a gate must lie on its named road.
export function validateFootprint(value) {
  const errors = [];
  const outer = ring(value?.outer);
  if (!outer) errors.push("invalid outer ring");
  const holes = Array.isArray(value?.holes) ? value.holes.map(ring) : null;
  if (!holes || holes.some((h) => !h)) errors.push("invalid holes");
  if (outer && holes && holes.every(Boolean)) {
    for (let i = 0; i < holes.length; i++) {
      if (touches(outer, holes[i]) || !inside(holes[i][0], outer))
        errors.push("hole outside or touching outer ring");
      for (let j = 0; j < i; j++)
        if (
          touches(holes[i], holes[j]) ||
          inside(holes[i][0], holes[j]) ||
          inside(holes[j][0], holes[i])
        )
          errors.push("holes overlap or touch");
    }
  }
  const items = value?.interactions;
  if (!Array.isArray(items)) errors.push("invalid interactions");
  else {
    const ids = new Set(),
      roads = new Map();
    for (const item of items) {
      if (
        !item ||
        typeof item.id !== "string" ||
        !item.id.trim() ||
        ids.has(item.id)
      ) {
        errors.push("invalid or duplicate interaction id");
        continue;
      }
      ids.add(item.id);
      if (item.type === "road") {
        const s = item.segment;
        if (
          !Array.isArray(s) ||
          s.length !== 2 ||
          !s.every(point) ||
          same(s[0], s[1])
        )
          errors.push("invalid road segment");
        else roads.set(item.id, s);
      } else if (item.type !== "gate") errors.push("invalid interaction type");
    }
    for (const item of items)
      if (item?.type === "gate") {
        const road = roads.get(item.roadId);
        if (!point(item.point) || !road || !on(item.point, road[0], road[1]))
          errors.push("invalid gate");
      }
  }
  return { valid: errors.length === 0, errors };
}

// Anchors are explicit local-plan points, not automatically routeAccess or
// physicalAnchor. Headings are clockwise degrees from north in [0,360).
// The heading difference rotates the measured geometry without scaling it.
export function placeFootprint(value, source, target) {
  const validFrame = (f) =>
    point(f?.anchor) &&
    Number.isFinite(f.headingDegrees) &&
    f.headingDegrees >= 0 &&
    f.headingDegrees < 360;
  if (
    !validateFootprint(value).valid ||
    !validFrame(source) ||
    !validFrame(target)
  )
    throw new RangeError("Invalid footprint or placement frame");
  const angle =
      ((target.headingDegrees - source.headingDegrees) * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const transform = (p) => {
    const x = p[0] - source.anchor[0],
      y = p[1] - source.anchor[1];
    return [
      target.anchor[0] + x * cos - y * sin,
      target.anchor[1] + x * sin + y * cos,
    ];
  };
  const result = {
    ...value,
    outer: value.outer.map(transform),
    holes: value.holes.map((r) => r.map(transform)),
    interactions: value.interactions.map((item) =>
      item.type === "road"
        ? { ...item, segment: item.segment.map(transform) }
        : { ...item, point: transform(item.point) },
    ),
  };
  if (
    !result.outer.every(point) ||
    !result.holes.every((r) => r.every(point)) ||
    !result.interactions.every((i) =>
      i.type === "road" ? i.segment.every(point) : point(i.point),
    )
  )
    throw new RangeError("Placement exceeds finite coordinates");
  return result;
}

// Compare in the same plan frame. Positive-area overlaps are always reported,
// even when contact is allowed. allowedInteractions names specific footprint
// roads/gates; it only permits boundary contact covered by those geometries.
export function assessFootprint(value, { bounds, polygons } = {}) {
  if (
    !validateFootprint(value).valid ||
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[0] >= bounds[2] ||
    bounds[1] >= bounds[3] ||
    !Array.isArray(polygons)
  )
    throw new RangeError("Invalid assessment input");
  const ids = new Set();
  for (const poly of polygons) {
    if (
      typeof poly?.id !== "string" ||
      !poly.id.trim() ||
      ids.has(poly.id) ||
      !validateFootprint({ ...poly, interactions: [] }).valid ||
      (poly.allowedInteractions !== undefined &&
        (!Array.isArray(poly.allowedInteractions) ||
          poly.allowedInteractions.some(
            (id) => !value.interactions.some((i) => i.id === id),
          )))
    )
      throw new RangeError("Invalid assessment polygon");
    ids.add(poly.id);
  }
  const allRings = (v) => [v.outer, ...v.holes];
  const area = (r) =>
    Math.abs(
      r
        .slice(0, -1)
        .reduce(
          (sum, p, i) =>
            sum +
            (p[0] - r[0][0]) * (r[i + 1][1] - r[0][1]) -
            (r[i + 1][0] - r[0][0]) * (p[1] - r[0][1]),
          0,
        ),
    ) / 2;
  const withinBounds = value.outer.every(
    ([x, y]) =>
      x >= bounds[0] && x <= bounds[2] && y >= bounds[1] && y <= bounds[3],
  );
  const overlaps = [],
    contacts = [],
    warnings = [];
  for (const road of value.interactions.filter((i) => i.type === "road")) {
    if (
      edges(ring(value.outer)).some(([a, b]) =>
        intersects(a, b, ...road.segment),
      )
    )
      warnings.push(
        `Road ${road.id} contacts or crosses the footprint boundary; review its intended access.`,
      );
  }
  for (const poly of polygons) {
    const intersection = polygonClipping.intersection(
      allRings(value),
      allRings(poly),
    );
    const overlapArea = intersection.reduce(
      (sum, part) =>
        sum + area(part[0]) - part.slice(1).reduce((n, r) => n + area(r), 0),
      0,
    );
    if (!Number.isFinite(overlapArea))
      throw new RangeError("Cannot assess polygon overlap");
    if (overlapArea > 0) {
      overlaps.push({ id: poly.id, area: overlapArea });
      continue;
    }
    const permitted = value.interactions.filter((i) =>
      (poly.allowedInteractions || []).includes(i.id),
    );
    let found = false,
      allowed = true;
    for (const r of allRings(value))
      for (const s of allRings(poly))
        for (const [a, b] of edges(ring(r)))
          for (const [c, d] of edges(ring(s))) {
            if (!intersects(a, b, c, d)) continue;
            found = true;
            // Collinear contacts are covered only when their full extent is covered.
            const points = [a, b, c, d].filter(
              (p) => on(p, a, b) && on(p, c, d),
            );
            if (!points.length) {
              const dx = b[0] - a[0],
                dy = b[1] - a[1],
                ex = d[0] - c[0],
                ey = d[1] - c[1];
              const t =
                ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / (dx * ey - dy * ex);
              points.push([a[0] + t * dx, a[1] + t * dy]);
            }
            const covered = permitted.some((i) =>
              i.type === "road"
                ? points.every((p) => on(p, ...i.segment))
                : points.every((p) => same(p, i.point)),
            );
            if (!covered) allowed = false;
          }
    if (found) contacts.push({ id: poly.id, allowed });
  }
  return { withinBounds, overlaps, contacts, warnings };
}
