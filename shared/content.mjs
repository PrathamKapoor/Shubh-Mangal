import { z } from "zod";
import { siteAccessSchema } from "./site-access.mjs";
import { structureSchema } from "./structure.mjs";
const s = z
  .string()
  .trim()
  .max(1000)
  // eslint-disable-next-line no-control-regex
  .refine((v) => !/[<>\u0000-\u001f]/.test(v), "Use plain text");
const source = {
  source: s.min(5),
  verifiedAt: z.string().datetime({ offset: true }).nullable(),
};
const asset = z
  .string()
  .regex(
    /^(?:\/assets\/(?:concepts\/)?[a-zA-Z0-9._-]+\.(?:png|jpg|jpeg|webp|svg|pdf|mp4)|\/api\/public\/media\/[a-f0-9]{64}\.(?:png|jpg|webp))$/,
    "Choose an approved local asset path",
  );
export const contentSchemas = {
  site_access: siteAccessSchema,
  structure: structureSchema,
  presentation: z
    .object({
      source: s.min(5),
      verifiedAt: z.string().datetime({ offset: true }).nullable(),
      placements: z
        .array(
          z
            .object({
              plotId: z.uuid(),
              geometryId: z.string().min(1).max(200),
              dx: z.number().min(-100).max(100),
              dy: z.number().min(-100).max(100),
              scale: z.number().min(0.5).max(2),
              rotation: z.number().min(-180).max(180),
            })
            .strict(),
        )
        .max(600),
    })
    .strict()
    .refine(
      (value) =>
        new Set(value.placements.map((p) => p.plotId)).size ===
        value.placements.length,
      {
        message: "Each approved plot may have only one visual placement",
        path: ["placements"],
      },
    ),
  setting: z
    .object({
      name: s.min(1),
      tagline: s,
      contactPhone: z.string().regex(/^(?:\+?[\d ()-]{8,25})?$/),
      contactEmail: z.union([z.email(), z.literal("")]),
      entrance: z
        .object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        })
        .nullable(),
      verified: z.boolean(),
      source: s.min(5),
    })
    .strict(),
  amenity: z
    .object({
      title: s.min(1),
      titleHi: s.default(""),
      description: s,
      descriptionHi: s.default(""),
      category: z
        .enum([
          "temple",
          "clubhouse",
          "garden",
          "fountain",
          "entrance",
          "other",
        ])
        .default("other"),
      location: z
        .object({
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        })
        .strict()
        .nullable()
        .default(null),
      placementPrecision: z
        .enum(["approximate", "surveyed"])
        .default("approximate"),
      visualScale: z.number().min(0.5).max(1.6).default(1),
      visualRotation: z.number().min(-180).max(180).default(0),
      customerVisible: z.boolean().default(true),
      imageUrl: z.union([asset, z.literal("")]).default(""),
      imageKind: z
        .enum(["photograph", "concept", "illustration"])
        .default("illustration"),
      state: z.enum([
        "confirmation_pending",
        "planned",
        "in_progress",
        "existing",
      ]),
      ...source,
    })
    .strict(),
  media: z
    .object({
      title: s.min(1),
      description: s,
      url: asset,
      category: z.enum(["document", "photography", "progress", "concept"]),
      revision: s.min(1),
      ...source,
    })
    .strict(),
  nearby: z
    .object({
      title: s.min(1),
      category: s.default(""),
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      distanceKm: z.number().nonnegative(),
      method: z.enum(["straight_line", "road_route"]),
      ...source,
    })
    .strict(),
};
