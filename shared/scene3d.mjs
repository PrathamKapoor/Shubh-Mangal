// Source/presentation map coordinates are local UTM: x increases east and y
// increases south. Three's world uses y up, so map south is world +z.
// This is a visual transform only; never derive legal dimensions from it.
export function toWorld(point, height = 0) {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !point.every(Number.isFinite) ||
    !Number.isFinite(height)
  )
    return null;
  return [point[0], height, point[1]];
}

export function fromWorld(point) {
  if (
    !Array.isArray(point) ||
    point.length !== 3 ||
    !point.every(Number.isFinite)
  )
    return null;
  return [point[0], point[2]];
}

// The current projected SVG source uses line-only paths. Parse its M/L/Z
// rings explicitly rather than flattening distinct polygons or their holes.
// Unsupported/invalid commands fail closed; empty and zero-area rings are
// ignored. Curves must be flattened upstream before they reach this renderer.
export function ringsFromPath(path) {
  if (typeof path !== "string" || !path.trim()) return [];
  const regex = /[MmLlZz]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g;
  const tokens = [];
  let end = 0;
  for (const match of path.matchAll(regex)) {
    if (!/^[\s,]*$/.test(path.slice(end, match.index))) return [];
    tokens.push(match[0]);
    end = match.index + match[0].length;
  }
  if (!/^[\s,]*$/.test(path.slice(end))) return [];

  const rings = [];
  let current = [],
    cursor = [0, 0],
    start = null,
    command = null,
    i = 0;
  const finish = () => {
    if (
      current.length > 1 &&
      current[0][0] === current.at(-1)[0] &&
      current[0][1] === current.at(-1)[1]
    )
      current.pop();
    const distinct = new Set(current.map(([x, y]) => `${x},${y}`));
    const twiceArea = current.reduce((sum, [x, y], index) => {
      const [nextX, nextY] = current[(index + 1) % current.length];
      return sum + x * nextY - nextX * y;
    }, 0);
    if (distinct.size >= 3 && Math.abs(twiceArea) > 1e-9) rings.push(current);
    current = [];
    start = null;
  };
  while (i < tokens.length) {
    if (/^[MmLlZz]$/.test(tokens[i])) {
      command = tokens[i++];
      if (command === "Z" || command === "z") {
        if (!start) return [];
        cursor = [...start];
        finish();
        command = null;
        continue;
      }
    }
    if (
      !command ||
      i + 1 >= tokens.length ||
      /^[A-Za-z]$/.test(tokens[i]) ||
      /^[A-Za-z]$/.test(tokens[i + 1])
    )
      return [];
    const dx = Number(tokens[i++]),
      dy = Number(tokens[i++]);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [];
    const relative = command === command.toLowerCase();
    const point = relative ? [cursor[0] + dx, cursor[1] + dy] : [dx, dy];
    if (!point.every(Number.isFinite)) return [];
    if (command === "M" || command === "m") {
      if (current.length) finish();
      start = [...point];
      command = relative ? "l" : "L";
    } else if (!start) return [];
    cursor = point;
    current.push(point);
  }
  if (current.length) finish();
  return rings;
}

const cross = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (p, a, b) =>
  Math.abs(cross(a, b, p)) < 1e-9 &&
  p[0] >= Math.min(a[0], b[0]) - 1e-9 &&
  p[0] <= Math.max(a[0], b[0]) + 1e-9 &&
  p[1] >= Math.min(a[1], b[1]) - 1e-9 &&
  p[1] <= Math.max(a[1], b[1]) + 1e-9;
function intersects(a, b, c, d) {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  )
    return true;
  return (
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  );
}
function strictlyInside(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i];
    if (onSegment(point, a, b)) return false;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
function validRing(input) {
  if (
    !Array.isArray(input) ||
    !input.every(
      (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite),
    )
  )
    return null;
  // Some supplied paths repeat a vertex consecutively after rounding. Removing
  // a zero-length edge preserves their shape and keeps those plots selectable.
  const ring = input
    .filter(
      (p, i) => i === 0 || p[0] !== input[i - 1][0] || p[1] !== input[i - 1][1],
    )
    .map((p) => [...p]);
  if (
    ring.length > 1 &&
    ring[0][0] === ring.at(-1)[0] &&
    ring[0][1] === ring.at(-1)[1]
  )
    ring.pop();
  if (
    ring.length < 3 ||
    new Set(ring.map((p) => p.join(","))).size !== ring.length
  )
    return null;
  const area = Math.abs(
    ring.reduce((sum, [x, y], i) => {
      const [nx, ny] = ring[(i + 1) % ring.length];
      return sum + x * ny - nx * y;
    }, 0),
  );
  if (area < 1e-9) return null;
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      if (
        intersects(
          ring[i],
          ring[(i + 1) % ring.length],
          ring[j],
          ring[(j + 1) % ring.length],
        )
      )
        return null;
    }
  }
  return { ring, area, parent: null, depth: 0 };
}
// SVG uses even-odd filling in the source map. Group truly nested contours so
// holes and islands remain correct independent of contour winding or order.
// Boundary-touching or crossing contours are not silently treated as holes.
export function classifyRings(input) {
  if (!Array.isArray(input)) return [];
  const rings = input
    .map(validRing)
    .filter(Boolean)
    .sort((a, b) => b.area - a.area);
  for (let i = 0; i < rings.length; i++) {
    const child = rings[i];
    const candidates = rings.slice(0, i).filter((outer) => {
      if (!child.ring.every((p) => strictlyInside(p, outer.ring))) return false;
      for (let a = 0; a < child.ring.length; a++) {
        for (let b = 0; b < outer.ring.length; b++) {
          if (
            intersects(
              child.ring[a],
              child.ring[(a + 1) % child.ring.length],
              outer.ring[b],
              outer.ring[(b + 1) % outer.ring.length],
            )
          )
            return false;
        }
      }
      return true;
    });
    child.parent = candidates.at(-1) || null;
    child.depth = child.parent ? child.parent.depth + 1 : 0;
  }
  return rings
    .filter((r) => r.depth % 2 === 0)
    .map((outer) => ({
      outer: outer.ring,
      holes: rings
        .filter((r) => r.parent === outer && r.depth % 2 === 1)
        .map((r) => r.ring),
    }));
}
