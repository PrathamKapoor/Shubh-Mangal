import { z } from "zod";

const text = z
  .string()
  .trim()
  .max(1000)
  .refine(
    // eslint-disable-next-line no-control-regex
    (value) => !/[<>\u0000-\u001f]/.test(value),
    "Use plain text",
  );
const point = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .strict();

// Shared validation keeps publication consumers and the content schema aligned.
// Null coordinates/date allow private drafts, not a usable visitor entrance.
export const siteAccessSchema = z
  .object({
    title: text.min(1),
    routeAccess: point.nullable(),
    physicalAnchor: point.nullable(),
    headingDegrees: z.number().min(0).lt(360).nullable().optional(),
    state: z.enum([
      "confirmation_pending",
      "planned",
      "in_progress",
      "existing",
    ]),
    source: text.min(5),
    sourceRevision: text.min(1),
    verifiedAt: z.string().datetime({ offset: true }).nullable(),
    customerVisible: z.boolean(),
  })
  .strict();

// Returns the published payload, never a draft or legacy entrance fallback.
export function reviewedVisitorAccess(content) {
  if (!Array.isArray(content)) return null;
  const item = content.find(
    (item) => item?.id === "visitor-entrance" && item.kind === "site_access",
  );
  const result = siteAccessSchema.safeParse(item?.published);
  if (!result.success) return null;
  const access = result.data;
  return access.state === "existing" &&
    access.verifiedAt &&
    access.routeAccess &&
    access.customerVisible
    ? item.published
    : null;
}

// Call with reviewedVisitorAccess's result. Never supplies the visitor's origin.
export function directionsUrl(access) {
  const result = point.safeParse(access?.routeAccess);
  if (!result.success) return null;
  const { lat, lon } = result.data;
  const params = new URLSearchParams({
    api: "1",
    destination: `${lat},${lon}`,
  });
  return `https://www.google.com/maps/dir/?${params}`;
}

// Approximate site-area search only: bounds centre is not a reviewed entrance,
// measured footprint, aligned placement, or a directions destination.
// Bounds use the layout convention [west, south, east, north].
export function siteAreaUrl(bounds) {
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite)
  )
    return null;
  const [west, south, east, north] = bounds;
  if (
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90 ||
    west >= east ||
    south >= north
  )
    return null;
  const params = new URLSearchParams({
    api: "1",
    query: `${(south + north) / 2},${(west + east) / 2}`,
  });
  return `https://www.google.com/maps/search/?${params}`;
}
