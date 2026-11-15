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
const point = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
// Closure is checked without rounding, projecting or rewriting coordinates.
// Topology and correspondence require a separate projected assessment.
const ring = z
  .array(point)
  .min(4)
  .max(100)
  .refine(
    (points) =>
      points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1],
    "Ring must be closed",
  );
const evidence = { source: text.min(5), sourceRevision: text.min(1) };

export const structureSchema = z
  .object({
    title: text.min(1),
    footprint: z
      .object({
        datum: z.literal("WGS84"),
        outer: ring,
        holes: z.array(ring).max(8),
        ...evidence,
      })
      .strict(),
    // Anchor is WGS84; heading is clockwise from north. Pivot is [right, up,
    // forward] in model metres and maps to the anchor at ground level.
    frame: z
      .object({
        physicalAnchor: z
          .object({
            lat: z.number().min(-90).max(90),
            lon: z.number().min(-180).max(180),
          })
          .strict(),
        headingDegrees: z.number().min(0).lt(360),
        modelAxes: z.literal("right-up-forward"),
        worldAxes: z.literal("east-up-south"),
        units: z.literal("metres"),
        pivot: z.tuple([
          z.number().finite(),
          z.number().finite(),
          z.number().finite(),
        ]),
      })
      .strict(),
    // Null means unknown, never zero or inferred from the model.
    height: z
      .object({ metres: z.number().positive().finite(), ...evidence })
      .strict()
      .nullable(),
    // An identifier and evidence only: this does not authorize or load an asset.
    model: z
      .object({
        assetId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
        revision: text.min(1),
        rights: text.min(1),
        correspondence: text.min(1),
      })
      .strict()
      .nullable(),
    verifiedAt: z.string().datetime({ offset: true }).nullable(),
    customerVisible: z.boolean(),
  })
  .strict();

// Public records omit review evidence. Model delivery is not yet supported.
export const publicStructureSchema = z.object({
  title: text.min(1),
  footprint: z.object({ outer: ring, holes: z.array(ring).max(8) }).strict(),
  frame: structureSchema.shape.frame,
  height: z.object({ metres: z.number().positive().finite() }).strict().nullable(),
  model: z.null(),
}).strict();
