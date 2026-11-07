import { z } from "zod";
export const statuses = [
  "unverified",
  "available",
  "reserved",
  "sold",
  "blocked",
];
export const roles = [
  "owner",
  "administrator",
  "sales",
  "reviewer",
  "viewer",
  "content_editor",
];
export const visitStatuses = [
  "requested",
  "contacted",
  "confirmed",
  "rescheduled",
  "completed",
  "no_show",
  "cancelled",
];
export const permissions = {
  review: ["owner", "administrator", "reviewer"],
  publish: ["owner", "administrator"],
  inventory: ["owner", "administrator", "sales"],
  leads: ["owner", "administrator", "sales"],
  content: ["owner", "administrator", "content_editor"],
  access: ["owner"],
  audit: ["owner", "administrator", "reviewer", "viewer"],
};
export const can = (role, action) =>
  permissions[action]?.includes(role) || false;
// Intentional rejection of control bytes in user input.
const text = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      // eslint-disable-next-line no-control-regex
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(v),
      "Use plain text without control characters or markup",
    );
export const reason = text(1000).min(
  8,
  "Explain the reason in at least 8 characters",
);
export const email = z.union([z.literal(""), z.email().max(254)]);
export const contactSchema = z
  .object({
    name: text(100).min(2),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d ()-]{8,25}$/, "Enter a valid phone number")
      .refine(
        (v) =>
          v.replace(/\D/g, "").length >= 8 && v.replace(/\D/g, "").length <= 15,
        "Use 8–15 digits",
      ),
    email: email.default(""),
    message: text(2000).default(""),
    consent: z.literal(true, { error: "Consent is required" }),
    language: z.enum(["en", "hi"]).default("en"),
    preferredContact: z.enum(["phone", "whatsapp", "email"]).default("phone"),
    plotIds: z.array(z.string().max(150)).max(3).default([]),
    website: z.string().max(0, "Spam check failed").default(""),
    preferredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.preferredContact === "email" && !value.email)
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Enter an email address for email contact",
      });
  });
export const dimensionSchema = z
  .object({
    name: text(80).min(1),
    metres: z.number().positive().max(10000),
    sourceText: text(150).min(1),
    edgeIndex: z.number().int().min(0).optional(),
  })
  .strict();
export const approvedDataSchema = z
  .object({
    number: text(50).min(1),
    block: text(80).min(1),
    phase: text(80).default(""),
    corner: z.boolean().nullable().default(null),
    parkFacing: z.boolean().nullable().default(null),
    documentIds: z
      .array(z.string().regex(/^[a-z0-9-]{1,80}$/))
      .max(20)
      .default([]),
    plotType: z
      .enum(["not_provided", "residential", "commercial", "mixed"])
      .default("not_provided"),
    areaSqM: z.number().positive().max(1000000).nullable().default(null),
    areaSourceText: text(150).default(""),
    dimensions: z.array(dimensionSchema).max(100).default([]),
    roadWidthMetres: z.number().positive().max(200).nullable().default(null),
    facing: z
      .enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"])
      .nullable()
      .default(null),
    sourceDocument: text(200).min(5),
    sourceRevision: text(100).min(1),
    reviewNote: reason,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.areaSqM && !v.areaSourceText)
      ctx.addIssue({
        code: "custom",
        path: ["areaSourceText"],
        message: "Keep the original area value and unit",
      });
  });
export const plotEditSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason,
    data: approvedDataSchema.optional(),
    status: z.enum(statuses).optional(),
    publication: z
      .enum(["draft", "reviewed", "published", "archived"])
      .optional(),
    priceINR: z.number().nonnegative().max(1e12).nullable().optional(),
    priceVisible: z.boolean().optional(),
  })
  .strict();
export function metres(value, unit) {
  return unit === "ft" ? value / 0.3048 : value;
}
export function areaValue(m2, unit) {
  return m2 / ({ sqm: 1, sqft: 0.09290304, sqyd: 0.83612736 }[unit] || 1);
}
export function parseLength(source) {
  const s = String(source).trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)$/i);
  if (m) return Number(m[1]);
  m = s.match(
    /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)(?:\s*(\d+(?:\.\d+)?)\s*(?:"|in|inches))?$/i,
  );
  if (!m || Number(m[2] || 0) >= 12)
    throw Error(
      "Use an explicit unit, e.g. 25'6\" or 6.7 m; inches must be below 12.",
    );
  return (Number(m[1]) + Number(m[2] || 0) / 12) * 0.3048;
}
export const formatNumber = (v) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v);
export function areaLabel(p, unit = "sqft") {
  return `${p.approved?.areaSqM != null ? "Verified" : "Approx."} ${formatNumber(areaValue(p.approved?.areaSqM ?? p.areaSqMApprox, unit))} ${{ sqm: "m²", sqft: "sq ft", sqyd: "sq yd" }[unit]}`;
}
export function filterPlots(
  plots,
  {
    query = "",
    block = "",
    approvedBlock = "",
    status = "",
    type = "",
    facing = "",
    phase = "",
    corner = "",
    minRoad = "",
    maxPrice = "",
    min = "",
    max = "",
    savedOnly = false,
    saved = [],
  } = {},
) {
  return plots
    .filter(
      (p) =>
        (!query ||
          `${p.label} ${p.block} ${p.approved?.phase || ""}`
            .toLowerCase()
            .replace(/\s+/g, "")
            .includes(query.toLowerCase().replace(/\s+/g, ""))) &&
        (!block || p.block === block) &&
        (!approvedBlock || (p.approved && p.block === approvedBlock)) &&
        (!status || p.status === status) &&
        (!type || (p.approved?.plotType || "not_provided") === type) &&
        (!facing || p.approved?.facing === facing) &&
        (!phase || p.approved?.phase === phase) &&
        (corner === "" ||
          (p.approved?.corner != null &&
            p.approved.corner === (corner === "yes"))) &&
        (minRoad === "" ||
          (p.approved?.roadWidthMetres != null &&
            p.approved.roadWidthMetres >= Number(minRoad))) &&
        (maxPrice === "" ||
          (p.priceINR != null && p.priceINR <= Number(maxPrice))) &&
        (!savedOnly || saved.includes(p.id)) &&
        (min === "" ||
          (p.approved?.areaSqM ?? p.areaSqMApprox) >= Number(min)) &&
        (max === "" || (p.approved?.areaSqM ?? p.areaSqMApprox) <= Number(max)),
    )
    .sort(
      (a, b) =>
        a.label.localeCompare(b.label, undefined, { numeric: true }) ||
        a.block.localeCompare(b.block, undefined, { numeric: true }),
    );
}

// Only reviewed, published records can establish a customer-facing block.
// A source KML area or a candidate number is never evidence of membership.
export function approvedBlocks(plots) {
  const groups = new Map();
  for (const plot of plots) {
    if (!plot.approved || plot.publication !== "published" || !plot.block)
      continue;
    const group = groups.get(plot.block) || { name: plot.block, plots: [] };
    group.plots.push(plot);
    groups.set(plot.block, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      bounds: [
        Math.min(...group.plots.map((p) => p.bounds[0])),
        Math.min(...group.plots.map((p) => p.bounds[1])),
        Math.max(...group.plots.map((p) => p.bounds[2])),
        Math.max(...group.plots.map((p) => p.bounds[3])),
      ],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function blockLabels(blocks, view, scale, viewport = null) {
  if (!Number.isFinite(scale) || scale <= 0) return [];
  const boxes = [],
    result = [];
  for (const block of blocks) {
    const x = (block.bounds[0] + block.bounds[2]) / 2,
      y = (block.bounds[1] + block.bounds[3]) / 2,
      w = `Block ${block.name}`.length * 8 + 10,
      h = 22,
      box = [
        (x - view[0]) * scale - w / 2,
        (y - view[1]) * scale - h / 2,
        w,
        h,
      ];
    if (
      box[0] < 0 ||
      box[1] < 0 ||
      box[0] + w > view[2] * scale ||
      box[1] + h > view[3] * scale
    )
      continue;
    if (
      boxes.some(
        (b) =>
          b[0] < box[0] + w &&
          b[0] + b[2] > box[0] &&
          b[1] < box[1] + h &&
          b[1] + b[3] > box[1],
      )
    )
      continue;
    if (viewport) {
      const sx = box[0] + (viewport[0] - view[2] * scale) / 2,
        sy = box[1] + (viewport[1] - view[3] * scale) / 2;
      const controls = [
        [viewport[0] - 65, 0, 65, 275],
        [0, 0, 65, 100],
        [0, viewport[1] - 60, 125, 60],
      ];
      if (
        controls.some(
          (b) =>
            b[0] < sx + w &&
            b[0] + b[2] > sx &&
            b[1] < sy + h &&
            b[1] + b[3] > sy,
        )
      )
        continue;
    }
    boxes.push(box);
    result.push({ name: block.name, x, y });
  }
  return result;
}

// Screen-space collision and clipping checks keep labels readable at every zoom.
// The selected label takes priority; other labels never shrink below 13px.
export function plotLabels(
  plots,
  selected,
  view,
  pixelsPerMetre,
  showOthers = true,
  viewport = null,
) {
  if (!Number.isFinite(pixelsPerMetre) || pixelsPerMetre <= 0) return [];
  const boxes = [],
    result = [];
  const ordered = [...plots].sort(
    (a, b) => Number(b.id === selected) - Number(a.id === selected),
  );
  for (const p of ordered) {
    const chosen = p.id === selected;
    if (!chosen && !showOthers) continue;
    const label = p.identityReviewRequired ? "?" : p.label;
    const width = Math.max(14, String(label).length * 8 + 8),
      height = 20;
    if (
      !chosen &&
      ((p.bounds[2] - p.bounds[0]) * pixelsPerMetre < width ||
        (p.bounds[3] - p.bounds[1]) * pixelsPerMetre < height)
    )
      continue;
    const x = (p.center[0] - view[0]) * pixelsPerMetre,
      y = (p.center[1] - view[1]) * pixelsPerMetre,
      box = [x - width / 2, y - height / 2, width, height];
    if (
      box[0] < 0 ||
      box[1] < 0 ||
      box[0] + width > view[2] * pixelsPerMetre ||
      box[1] + height > view[3] * pixelsPerMetre
    )
      continue;
    if (viewport) {
      const left = (viewport[0] - view[2] * pixelsPerMetre) / 2,
        top = (viewport[1] - view[3] * pixelsPerMetre) / 2,
        onScreen = [box[0] + left, box[1] + top, width, height];
      const controls = [
        [viewport[0] - 65, 0, 65, 275],
        [0, 0, 65, 100],
        [0, viewport[1] - 60, 125, 60],
      ];
      if (
        controls.some(
          (b) =>
            b[0] < onScreen[0] + width &&
            b[0] + b[2] > onScreen[0] &&
            b[1] < onScreen[1] + height &&
            b[1] + b[3] > onScreen[1],
        )
      )
        continue;
    }
    if (
      !chosen &&
      boxes.some(
        (b) =>
          b[0] < box[0] + width &&
          b[0] + b[2] > box[0] &&
          b[1] < box[1] + height &&
          b[1] + b[3] > box[1],
      )
    )
      continue;
    boxes.push(box);
    result.push({
      id: p.id,
      x: p.center[0],
      y: p.center[1],
      label,
      selected: chosen,
    });
  }
  return result;
}
export function dimensionLabels(plot, pixelsPerMetre, unit = "ft") {
  const boxes = [];
  return plot.edges.flatMap((edge, i) => {
    const dx = edge.b[0] - edge.a[0],
      dy = edge.b[1] - edge.a[1],
      length = Math.hypot(dx, dy);
    if (length * pixelsPerMetre < 55) return [];
    const x = (edge.a[0] + edge.b[0]) / 2,
      y = (edge.a[1] + edge.b[1]) / 2;
    const sign =
      (x - plot.center[0]) * -dy + (y - plot.center[1]) * dx >= 0 ? 1 : -1;
    const offset = 16 / pixelsPerMetre,
      cx = x - ((sign * dy) / length) * offset,
      cy = y + ((sign * dx) / length) * offset;
    const verified = plot.approved?.dimensions?.find((d) => d.edgeIndex === i);
    const label = `${verified ? "Verified" : "Approx."} ${formatNumber(metres(verified?.metres ?? edge.metres, unit))} ${unit}`;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    const rad = (angle * Math.PI) / 180,
      w = label.length * 7,
      h = 16,
      bw = Math.abs(Math.cos(rad)) * w + Math.abs(Math.sin(rad)) * h,
      bh = Math.abs(Math.sin(rad)) * w + Math.abs(Math.cos(rad)) * h;
    const b = [
      cx * pixelsPerMetre - bw / 2,
      cy * pixelsPerMetre - bh / 2,
      bw,
      bh,
    ];
    if (
      boxes.some(
        (a) =>
          a[0] < b[0] + b[2] &&
          a[0] + a[2] > b[0] &&
          a[1] < b[1] + b[3] &&
          a[1] + a[3] > b[1],
      )
    )
      return [];
    boxes.push(b);
    return [{ x: cx, y: cy, angle, label, edgeIndex: i }];
  });
}
