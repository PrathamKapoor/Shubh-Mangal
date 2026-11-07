// Presentation coordinates are independent of source measurements. A placement
// remains explicitly tied to both a stable plot ID and its mapped source ID.
const pointPattern = /([ML])\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/g;
export function presentationRing(path) {
  return [...path.matchAll(pointPattern)].map((match) => [
    Number(match[2]),
    Number(match[3]),
  ]);
}
export function presentationPoint(point, center, placement) {
  const angle = (placement.rotation * Math.PI) / 180;
  const dx = (point[0] - center[0]) * placement.scale;
  const dy = (point[1] - center[1]) * placement.scale;
  return [
    center[0] + placement.dx + dx * Math.cos(angle) - dy * Math.sin(angle),
    center[1] + placement.dy + dx * Math.sin(angle) + dy * Math.cos(angle),
  ];
}
export function presentationPlot(plot, placement) {
  if (
    !placement ||
    placement.plotId !== plot.id ||
    placement.geometryId !== plot.geometryId
  )
    return plot;
  const points = presentationRing(plot.path).map((point) =>
    presentationPoint(point, plot.center, placement),
  );
  if (points.length < 3) return plot;
  const xs = points.map((point) => point[0]),
    ys = points.map((point) => point[1]);
  return {
    ...plot,
    path: `M${points.map((point) => point.map((n) => Number(n.toFixed(4))).join(",")).join(" L")} Z`,
    center: presentationPoint(plot.center, plot.center, placement),
    bounds: [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ],
    edges: plot.edges.map((edge) => ({
      ...edge,
      a: presentationPoint(edge.a, plot.center, placement),
      b: presentationPoint(edge.b, plot.center, placement),
    })),
  };
}
// Bound the editable canvas to guard against accidental invalid coordinates;
// this deliberately does not require the result to lie inside source geometry.
export function presentationPlacementValid(geometry, placement) {
  const values = [
    placement?.dx,
    placement?.dy,
    placement?.scale,
    placement?.rotation,
  ];
  if (
    !values.every(Number.isFinite) ||
    Math.abs(placement.dx) > 100 ||
    Math.abs(placement.dy) > 100 ||
    placement.scale < 0.5 ||
    placement.scale > 2 ||
    Math.abs(placement.rotation) > 180
  )
    return false;
  const ring = presentationRing(geometry?.path || "");
  if (!(
    ring.length >= 3 &&
    Array.isArray(geometry.center) &&
    geometry.center.length === 2 &&
    geometry.center.every(Number.isFinite) &&
    ring.every((point) => point.every(Number.isFinite))
  ))
    return false;
  const twiceArea = ring.reduce((sum, point, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  if (Math.abs(twiceArea) < 1e-6) return false;
  // Limits correspond to the full supplied scene viewBox, not parcel bounds.
  return ring
    .map((point) => presentationPoint(point, geometry.center, placement))
    .every(([x, y]) => x >= -8 && x <= 397.545 && y >= -8 && y <= 480.176);
}
const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function onSegment(point, a, b) {
  const epsilon = 1e-6;
  return (
    Math.abs(cross(a, b, point)) < epsilon &&
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  );
}
function insideOrBoundary(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    if (onSegment(point, a, b)) return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function properIntersection(a, b, c, d) {
  return (
    cross(a, b, c) * cross(a, b, d) < -1e-10 &&
    cross(c, d, a) * cross(c, d, b) < -1e-10
  );
}
// Restrict editable artwork to its already-mapped polygon; it cannot be moved
// onto an unrelated parcel or road. This is an engineering check, not a survey.
export function presentationFitsSource(geometry, placement) {
  const source = presentationRing(geometry.path);
  if (
    source.length > 1 &&
    source[0][0] === source.at(-1)[0] &&
    source[0][1] === source.at(-1)[1]
  )
    source.pop();
  if (source.length < 3 || !Array.isArray(geometry.center)) return false;
  const transformed = source.map((p) =>
    presentationPoint(p, geometry.center, placement),
  );
  for (let i = 0; i < transformed.length; i++) {
    const a = transformed[i],
      b = transformed[(i + 1) % transformed.length];
    for (const fraction of [0, 0.25, 0.5, 0.75]) {
      if (
        !insideOrBoundary(
          [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction],
          source,
        )
      )
        return false;
    }
    for (let j = 0; j < source.length; j++)
      if (properIntersection(a, b, source[j], source[(j + 1) % source.length]))
        return false;
  }
  return true;
}
