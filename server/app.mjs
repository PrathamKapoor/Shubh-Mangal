import express from "express";
import helmet from "helmet";
import compression from "compression";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  contactSchema,
  approvedDataSchema,
  plotEditSchema,
  reason,
  roles,
  visitStatuses,
  can,
} from "../shared/domain.mjs";
import {
  hash,
  checkPassword,
  passwordHash,
  createUser,
  audit,
} from "./auth.mjs";
import {
  HttpError,
  requirePermission,
  approveDraft,
  updatePlot,
  getPlot,
  publicPlot,
} from "./inventory.mjs";
import { contentSchemas } from "./content.mjs";
import { publicStructureSchema } from "../shared/structure.mjs";
import { measuredStructureGeometry, measuredGateGeometry } from "../shared/measured-structure.mjs";
import { presentationPlacementValid } from "../shared/presentation.mjs";
import {
  stageGeometry,
  geographicToPlan,
  planToGeographic,
} from "./geometry.mjs";
import sourceLayout from "../public/data/layout.json" with { type: "json" };
import {
  ownerAmenityReferences,
  referenceFor,
  referenceContains,
  OWNER_AMENITY_SOURCE,
} from "../shared/owner-amenity-references.mjs";
import { stageImage, mediaFile } from "./media.mjs";
import { publicGeometry } from "./public-geometry.mjs";
import { loadPublicSnapshot } from "./public-snapshot.mjs";
import {
  reviewedVisitorAccess,
  siteAccessFootprintSchema,
} from "../shared/site-access.mjs";
import { geographicToPlan as projectFootprintPoint } from "../shared/geography.mjs";
import { validateFootprint, assessFootprint } from "../shared/footprint.mjs";
import { createSiteConfig, plotPageTitle } from "../shared/site-config.mjs";
const uuid = z.uuid();
const json = (v) => JSON.stringify(v);
function footprintProjector(sourceLayout) {
  return ([lon, lat]) => {
    // The source layout's UTM zone is not a global projection.
    const [west, south, east] = sourceLayout.geographicBounds;
    if (
      Math.abs(lon - (west + east) / 2) > 3 ||
      (south >= 0 ? lat < 0 : lat > 0) ||
      lat < -80 ||
      lat > 84
    )
      throw new HttpError(
        422,
        "Footprint is outside the layout projection region",
      );
    const { x, y } = projectFootprintPoint({ lon, lat }, sourceLayout);
    return [x, y];
  };
}
// Called after the proposed publication while the shared spatial lock is held.
// A thrown error rolls the publication and its audit entry back together.
async function assessPublishedParcel(id, db, layout) {
  const current = await publicGeometry(db, layout);
  const count = Number((await db.query("SELECT count(*) AS n FROM plots WHERE publication='published'")).rows[0].n);
  if (current.features.length !== current.mappings.length || current.mappings.length !== count)
    throw new HttpError(422, "A published plot has no usable geometry; resolve it before publishing another plot");
  const project = footprintProjector(layout);
  const polygons = [];
  for (const feature of current.features) {
    try {
      const geometry = feature.geometry;
      const parts = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
      if (!Array.isArray(parts) || !parts.length) throw Error("unsupported geometry");
      for (const [index, rings] of parts.entries()) {
        const polygon = { id: `${feature.id}:${index}`, outer: rings[0].map(project), holes: rings.slice(1).map((ring) => ring.map(project)) };
        if (!validateFootprint({ ...polygon, interactions: [] }).valid) throw Error("invalid geometry");
        polygons.push(polygon);
      }
    } catch {
      throw new HttpError(422, `Published plot ${feature.id} has invalid or unsupported geometry`);
    }
  }
  const proposed = polygons.filter((polygon) => polygon.id.startsWith(`${id}:`));
  if (!proposed.length) throw new HttpError(422, "The proposed plot has no usable geometry");
  const others = polygons.filter((polygon) => !polygon.id.startsWith(`${id}:`));
  const [x,y,w,h] = layout.viewBox;
  for (const polygon of proposed) {
    const assessment = assessFootprint({ ...polygon, interactions: [] }, { bounds: [x,y,x+w,y+h], polygons: others });
    if (assessment.overlaps.length)
      throw new HttpError(422, `Plot overlaps published plot ${assessment.overlaps[0].id.split(":")[0]}`);
  }
}
async function assessAccessFootprint(footprint, db, sourceLayout) {
  const project = footprintProjector(sourceLayout);
  const projected = {
    outer: footprint.outer.map(project),
    holes: footprint.holes.map((r) => r.map(project)),
    interactions: footprint.interactions.map((i) =>
      i.type === "road"
        ? { ...i, segment: i.segment.map(project) }
        : { ...i, point: project(i.point) },
    ),
  };
  if (!validateFootprint(projected).valid)
    throw new HttpError(
      422,
      "Invalid footprint topology or access interactions",
    );
  const [x, y, w, h] = sourceLayout.viewBox;
  const current = await publicGeometry(db, sourceLayout);
  const publishedCount = Number((await db.query("SELECT count(*) AS n FROM plots WHERE publication='published'")).rows[0].n);
  if (current.features.length !== current.mappings.length || current.mappings.length !== publishedCount)
    throw new HttpError(422, "A published plot has no usable geometry; resolve it before reviewing the entrance footprint");
  const polygons = [];
  for (const feature of current.features) {
    const geometry = feature.geometry;
    try {
      const parts = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
      if (!Array.isArray(parts) || !parts.length) throw Error("unsupported geometry");
      for (const [index, rings] of parts.entries()) {
        const polygon = { id: `${feature.id}:${index}`, outer: rings[0].map(project), holes: rings.slice(1).map((ring) => ring.map(project)) };
        if (!validateFootprint({ ...polygon, interactions: [] }).valid) throw Error("invalid geometry");
        polygons.push(polygon);
      }
    } catch {
      throw new HttpError(422, `Published plot ${feature.id} has invalid or unsupported geometry`);
    }
  }
  const assessment = assessFootprint(projected, {
    bounds: [x, y, x + w, y + h],
    polygons,
  });
  if (!assessment.withinBounds)
    throw new HttpError(422, "Footprint is outside the source plan extent");
  if (assessment.overlaps.length)
    throw new HttpError(422, `Footprint overlaps published plot ${assessment.overlaps[0].id.split(":")[0]}`);
  assessment.warnings.push("Reviewed structure and road-clearance checks are not available; inspect those relationships before publication.");
  return assessment;
}

function assessModelBinding(data, layout) {
  if (data.model === null) return;
  if (data.model.assetId !== "synthetic-building" || data.model.revision !== "v1" || !data.model.dimensions)
    throw new HttpError(422, "Unsupported model or missing measured dimensions");
  const project = footprintProjector(layout);
  const anchor = project([data.frame.physicalAnchor.lon, data.frame.physicalAnchor.lat]);
  let model;
  try {
    model = measuredStructureGeometry({
      anchor, bearingDegrees: data.frame.headingDegrees,
      pivot: [data.frame.pivot[0], data.frame.pivot[2]], dimensions: data.model.dimensions,
      height: data.height?.metres ?? null,
    });
  } catch {
    throw new HttpError(422, "Invalid model dimensions");
  }
  const actual = data.footprint.outer.slice(0, -1).map(project);
  // 1 mm allows WGS84 conversion round-off, not survey uncertainty.
  const matches = actual.length === model.footprint.length && actual.some((_, offset) =>
    [1, -1].some((direction) => actual.every((point, index) => {
      const expected = model.footprint[(offset + direction * index + actual.length) % actual.length];
      return Math.hypot(point[0] - expected[0], point[1] - expected[1]) <= 0.001;
    })));
  if (!matches || data.footprint.holes.length || data.frame.pivot[1] !== 0)
    throw new HttpError(422, "Model footprint does not match the reviewed footprint and ground pivot");
}

function assessGateBinding(data, layout) {
  if (!data.model) return;
  if (!data.footprint || !data.physicalAnchor || data.headingDegrees == null || data.model.pivot[1] !== 0)
    throw new HttpError(422, "A gate model requires a reviewed footprint, anchor, bearing and ground pivot");
  const project = footprintProjector(layout);
  const anchor = project([data.physicalAnchor.lon,data.physicalAnchor.lat]);
  let gate;
  try { gate = measuredGateGeometry({anchor,bearingDegrees:data.headingDegrees,
    pivot:[data.model.pivot[0],data.model.pivot[2]],dimensions:data.model.dimensions,
    height:data.model.height?.metres ?? null});
  } catch { throw new HttpError(422,"Invalid gate dimensions"); }
  const actual = data.footprint.outer.slice(0,-1).map(project);
  const matches = actual.length === gate.footprint.length && actual.some((_,offset) =>
    [1,-1].some((direction) => actual.every((point,index) => {
      const expected = gate.footprint[(offset + direction * index + actual.length) % actual.length];
      return Math.hypot(point[0]-expected[0],point[1]-expected[1]) <= 0.001;
    })));
  if (!matches || data.footprint.holes.length)
    throw new HttpError(422,"Gate model footprint does not match the reviewed footprint");
}

// Call under the spatial write lock for mutations. The same checks on reads
// suppress invalid public projections without changing the stored record.
async function assessStructure(data, id, db, layout) {
  const footprint = { ...data.footprint, interactions: [] };
  const plots = await assessAccessFootprint(footprint, db, layout);
  const warnings = plots.contacts.map((contact) => `Contact with published plot ${contact.id.split(":")[0]}; clearance review is pending.`);
  const project = footprintProjector(layout);
  const anchor = project([data.frame.physicalAnchor.lon, data.frame.physicalAnchor.lat]);
  const [x, y, w, h] = layout.viewBox;
  if (anchor[0] < x || anchor[0] > x + w || anchor[1] < y || anchor[1] > y + h)
    throw new HttpError(422, "Structure anchor is outside the source plan extent");
  const projected = { outer: footprint.outer.map(project), holes: footprint.holes.map((ring) => ring.map(project)), interactions: [] };
  const rows = (await db.query("SELECT id,kind,published FROM content WHERE published IS NOT NULL AND (kind='structure' OR kind='site_access') AND id<>$1", [id])).rows;
  const polygons = [];
  for (const row of rows) {
    const value = row.published;
    if (row.kind === "site_access" && !value?.footprint) {
      warnings.push(`Published access ${row.id} has no footprint; clearance review is pending.`);
      continue;
    }
    if (row.kind === "structure" && !contentSchemas.structure.safeParse(value).success)
      throw new HttpError(422, `Published structure ${row.id} is invalid`);
    if (row.kind === "site_access" && !contentSchemas.site_access.safeParse(value).success)
      throw new HttpError(422, "Published access is invalid");
    if (!value.footprint)
      throw new HttpError(422, `Published ${row.kind} ${row.id} has no assessable footprint`);
    try {
      const polygon = { id: row.id, outer: value.footprint.outer.map(project), holes: value.footprint.holes.map((ring) => ring.map(project)) };
      if (!validateFootprint({ ...polygon, interactions: [] }).valid) throw Error("invalid geometry");
      polygons.push(polygon);
    } catch {
      throw new HttpError(422, `Published footprint ${row.id} is invalid`);
    }
  }
  const assessment = assessFootprint(projected, { bounds: [x, y, x + w, y + h], polygons });
  if (assessment.overlaps.length)
    throw new HttpError(422, `Structure conflicts with published footprint ${assessment.overlaps[0].id}`);
  for (const contact of assessment.contacts)
    warnings.push(`Contact with published footprint ${contact.id}; clearance review is pending.`);
  return { warnings };
}
export function createApp(
  db,
  {
    origin = process.env.APP_ORIGIN || "http://127.0.0.1:5173",
    demo = process.env.DEMO_MODE !== "false",
    production = process.env.NODE_ENV === "production",
    serveStatic = false,
    logging = true,
    googleMaps = process.env.GOOGLE_MAPS_ENABLED === "true",
    mediaDirectory = process.env.MEDIA_DIRECTORY || ".local/media",
    siteConfig = process.env.SITE_NAME === undefined
      ? undefined
      : { name: process.env.SITE_NAME },
    sourceLayout: selectedLayout = sourceLayout,
    sourceBundle = selectedLayout === sourceLayout ? "public/data/layout.json" : null,
    sourceIdentity = null,
    staticDirectory = "dist",
    sourceAssets = sourceBundle === "public/data/layout.json" ? { schematic: "/assets/geographic-layout.svg", surveyPlan: "/assets/survey-plan-north.png", poster: "/assets/colony-poster.png", surveyPdf: "/downloads/survey-plan-north.pdf", kml: "/downloads/Shubh_Mangal_Full_Layout.kml" } : { schematic: null, surveyPlan: null, poster: null, surveyPdf: null, kml: null },
  } = {},
) {
  const publicSiteConfig = createSiteConfig(siteConfig);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (googleMaps) res.locals.cspNonce = randomBytes(18).toString("base64");
    res.set("Permissions-Policy", "geolocation=(self)");
    next();
  });
  if (process.env.TRUST_PROXY_HOPS)
    app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: googleMaps
            ? [
                "'self'",
                (_req, res) => `'nonce-${res.locals.cspNonce}'`,
                "'strict-dynamic'",
                "'unsafe-eval'",
                "blob:",
              ]
            : ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            ...(googleMaps ? ["https://fonts.googleapis.com"] : []),
          ],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            ...(googleMaps
              ? [
                  "https://*.googleapis.com",
                  "https://*.gstatic.com",
                  "https://*.google.com",
                  "https://*.googleusercontent.com",
                ]
              : []),
          ],
          connectSrc: [
            "'self'",
            ...(googleMaps
              ? [
                  "https://*.googleapis.com",
                  "https://*.gstatic.com",
                  "https://*.google.com",
                  "data:",
                  "blob:",
                ]
              : []),
          ],
          ...(googleMaps
            ? {
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                frameSrc: ["https://*.google.com"],
                workerSrc: ["'self'", "blob:"],
              }
            : {}),
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: "256kb" }));
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set("X-Request-Id", req.requestId);
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    if (logging)
      res.on("finish", () =>
        console.info(
          json({
            requestId: req.requestId,
            method: req.method,
            route: req.route?.path || "unmatched",
            status: res.statusCode,
          }),
        ),
      );
    next();
  });
  app.use("/api", async (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== origin
    )
      throw new HttpError(403, "Request origin is not allowed");
    const token = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("sm_session="))
      ?.slice(11);
    if (token) {
      const s = (
        await db.query(
          "SELECT s.csrf,u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
          [hash(token)],
        )
      ).rows[0];
      if (s) req.user = s;
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.path.startsWith("/admin") &&
      (!req.user || req.get("x-csrf-token") !== req.user.csrf)
    )
      throw new HttpError(req.user ? 403 : 401, "Sign in and refresh the page");
    next();
  });
  async function rate(req, scope, limit) {
    const key = hash(`${scope}:${req.ip}`);
    const r = await db.query(
      "INSERT INTO rate_limits(key,hits,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.reset_at<now() THEN 1 ELSE rate_limits.hits+1 END,reset_at=CASE WHEN rate_limits.reset_at<now() THEN now()+interval '15 minutes' ELSE rate_limits.reset_at END RETURNING hits",
      [key],
    );
    if (r.rows[0].hits > limit)
      throw new HttpError(
        429,
        "Too many attempts. Please try again in 15 minutes.",
      );
  }
  async function idempotent(req, scope, fn) {
    const key = z
      .string()
      .min(16)
      .max(100)
      .regex(/^[a-zA-Z0-9-]+$/)
      .parse(req.get("Idempotency-Key"));
    const digest = hash(json(req.body));
    return db.transaction(async (tx) => {
      // A transaction-scoped advisory lock serializes duplicate retries on PostgreSQL.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `${scope}:${key}`,
      ]);
      // All supported spatial writes take one database-scoped transaction
      // lock before reading state. This also covers new mappings, which cannot
      // be protected by locking only rows found by a prior overlap query.
      const spatial = /^(plot|content|site-access-footprint|geometry|geometry-stage|reconcile|import|inventory-import):/.test(scope);
      if (spatial)
        await tx.query("SELECT pg_advisory_xact_lock(19483,11479)");
      const cached = (
        await tx.query("SELECT * FROM idempotency WHERE scope=$1 AND key=$2", [
          scope,
          key,
        ])
      ).rows[0];
      if (cached) {
        if (cached.request_hash !== digest)
          throw new HttpError(
            409,
            "This retry key was used with different data",
          );
        return cached.response;
      }
      let result = await fn(tx);
      if (scope.startsWith("plot:") && req.body.publication === "published") {
        await assessPublishedParcel(req.params.id, tx, selectedLayout);
        const items = (await tx.query("SELECT id,kind,published FROM content WHERE id='visitor-entrance' AND published IS NOT NULL")).rows;
        const access = reviewedVisitorAccess(items);
        if (access?.footprint)
          await assessAccessFootprint(access.footprint, tx, selectedLayout);
      }
      if ((scope.startsWith("plot:") && req.body.publication === "published") ||
          (scope.startsWith("content:") && req.body.kind === "site_access" && req.body.publish)) {
        const structures = (await tx.query("SELECT id,published FROM content WHERE kind='structure' AND published IS NOT NULL")).rows;
        const warnings = [];
        for (const item of structures) {
          const parsed = contentSchemas.structure.safeParse(item.published);
          if (!parsed.success) throw new HttpError(422, `Published structure ${item.id} is invalid`);
          const assessment = await assessStructure(parsed.data, item.id, tx, selectedLayout);
          warnings.push(...assessment.warnings.map((warning) => `${item.id}: ${warning}`));
        }
        if (warnings.length) result = { ...result, structureAssessment: { warnings } };
      }
      await tx.query(
        "INSERT INTO idempotency(scope,key,request_hash,response) VALUES($1,$2,$3,$4)",
        [scope, key, digest, json(result)],
      );
      return result;
    });
  }
  const auth = (action) => {
    return (req, res, next) => {
      requirePermission(req.user, action);
      next();
    };
  };
  app.get("/api/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({
      ok: true,
      mode: demo ? "local-demo" : "connected",
      storage: db.kind,
    });
  });
  app.get("/api/public/layout", (req, res) => {
    if (demo) return res.json(selectedLayout);
    // Connected visitors receive projection metadata only; the static source
    // cells and areas are provisional and are not published inventory.
    res.json({
      project: publicSiteConfig.name,
      viewBox: selectedLayout.viewBox,
      origin: selectedLayout.origin,
      geographicBounds: selectedLayout.geographicBounds,
      plots: [],
      areas: [],
      annotations: [],
    });
  });
  async function publicProject(db) {
    const items = (
      await db.query(
        "SELECT id,kind,published FROM content WHERE published IS NOT NULL",
      )
    ).rows;
    const access = reviewedVisitorAccess(items);
    const publicStructures = new Set();
    for (const item of items.filter((entry) => entry.kind === "structure")) {
      const parsed = contentSchemas.structure.safeParse(item.published);
      if (!parsed.success || !parsed.data.verifiedAt || !parsed.data.customerVisible) continue;
      try {
        assessModelBinding(parsed.data, selectedLayout);
        await assessStructure(parsed.data, item.id, db, selectedLayout);
        publicStructures.add(item.id);
      } catch { /* Keep invalid or conflicting structures private. */ }
    }
    let siteAccessStatus = access ? "available" : "unavailable";
    if (access) {
      try {
        assessGateBinding(access, selectedLayout);
        if (access.footprint) await assessAccessFootprint(access.footprint, db, selectedLayout);
      } catch {
        // Hide both gate and directions when the current parcel snapshot
        // cannot validate a previously published footprint. Keep the record
        // and its audit history intact for staff review.
        siteAccessStatus = "needs_review";
      }
    }
    const publicMappings = items.some((item) => item.kind === "presentation")
      ? new Map(
          (
            await db.query(
              "SELECT p.id,g.draft_id FROM plots p JOIN plot_geometry g ON g.plot_id=p.id WHERE p.publication='published'",
            )
          ).rows.map((row) => [row.id, row.draft_id]),
        )
      : new Map();
    return {
      mode: demo ? "local-demo" : "connected",
      geographicBounds: selectedLayout.geographicBounds,
      legacyReferenceAvailable: demo && sourceBundle === "public/data/layout.json",
      legacySource: sourceBundle === "public/data/layout.json",
      sourceIdentity,
      siteAccessStatus,
      siteConfig: publicSiteConfig,
      sourceAssets,
      items: items
        .filter(
          (item) =>
            (item.kind !== "amenity" ||
              item.published.customerVisible !== false) &&
            (item.kind !== "structure" || publicStructures.has(item.id)) &&
            (item.kind !== "site_access" ||
              (siteAccessStatus === "available" && Boolean(reviewedVisitorAccess([item])))),
        )
        .map((item) =>
          item.kind === "structure"
            ? { id: item.id, kind: item.kind, published: publicStructureSchema.parse({
                title: item.published.title,
                footprint: { outer: item.published.footprint.outer, holes: item.published.footprint.holes },
                frame: item.published.frame,
                height: item.published.height ? { metres: item.published.height.metres } : null,
                model: item.published.model ? {
                  assetId: item.published.model.assetId, revision: item.published.model.revision,
                  dimensions: (({width, depth, cutoutWidth, cutoutDepth}) => ({width, depth, cutoutWidth, cutoutDepth}))(item.published.model.dimensions),
                } : null,
              }) }
            : item.kind === "site_access"
            ? {
                ...item,
                published: {
                  title: item.published.title,
                  routeAccess: item.published.routeAccess,
                  physicalAnchor: item.published.physicalAnchor,
                  ...(item.published.headingDegrees !== undefined ? { headingDegrees: item.published.headingDegrees } : {}),
                  ...(item.published.model ? { model: {
                    assetId: item.published.model.assetId, revision: item.published.model.revision,
                    pivot: item.published.model.pivot,
                    dimensions: (({width,depth,leftPostWidth,rightPostWidth}) => ({width,depth,leftPostWidth,rightPostWidth}))(item.published.model.dimensions),
                    height: item.published.model.height ? {metres:item.published.model.height.metres} : null,
                  } } : {}),
                  state: item.published.state,
                  source: item.published.source,
                  sourceRevision: item.published.sourceRevision,
                  verifiedAt: item.published.verifiedAt,
                  customerVisible: item.published.customerVisible,
                  ...(item.published.footprint ? { footprint: {
                    outer: item.published.footprint.outer,
                    holes: item.published.footprint.holes,
                  } } : {}),
                },
              }
            : item.kind === "presentation"
            ? {
                ...item,
                published: {
                  ...item.published,
                  placements: item.published.placements.filter(
                    (entry) =>
                      publicMappings.get(entry.plotId) === entry.geometryId,
                  ),
                },
              }
            : item.kind === "amenity" && item.published.location
              ? {
                  ...item,
                  published: {
                    ...item.published,
                    mapPoint: geographicToPlan(item.published.location, selectedLayout),
                  },
                }
              : item,
        ),
    };
  }
  app.get("/api/public/project", async (_req, res) => res.json(await publicProject(db)));
  app.get("/api/public/snapshot", async (_req, res) => res.json(await loadPublicSnapshot(db, selectedLayout, publicProject)));
  app.get("/api/public/media/:name", async (req, res, next) => {
    const path = mediaFile(mediaDirectory, req.params.name);
    const url = `/api/public/media/${req.params.name}`;
    const reference = await db.query(
      `SELECT id FROM content WHERE published IS NOT NULL AND
      ((kind='amenity' AND COALESCE(published->>'customerVisible','true')='true' AND published->>'imageUrl'=$1)
       OR (kind='media' AND published->>'url'=$1)) LIMIT 1`,
      [url],
    );
    if (!reference.rows.length) throw new HttpError(404, "Image not found");
    res.type(
      req.params.name.endsWith(".jpg")
        ? "image/jpeg"
        : req.params.name.endsWith(".png")
          ? "image/png"
          : "image/webp",
    );
    res.sendFile(path, (error) => {
      if (error) next(new HttpError(404, "Image not found"));
    });
  });
  app.post(
    "/api/admin/media",
    auth("content"),
    express.raw({
      type: ["image/png", "image/jpeg", "image/webp"],
      limit: "2mb",
    }),
    async (req, res) => {
      await rate(req, "media", 30);
      const image = await stageImage(
        mediaDirectory,
        req.body,
        req.get("content-type"),
      );
      await db.transaction((tx) =>
        audit(
          tx,
          req.user,
          "media.stage",
          image.name,
          null,
          { type: image.type, size: image.size },
          "Owner staged an image for content review",
        ),
      );
      res.status(201).json(image);
    },
  );
  app.get("/api/admin/media/:name", auth("content"), async (req, res, next) => {
    const path = mediaFile(mediaDirectory, req.params.name);
    res.type(
      req.params.name.endsWith(".jpg")
        ? "image/jpeg"
        : req.params.name.endsWith(".png")
          ? "image/png"
          : "image/webp",
    );
    res.sendFile(path, (error) => {
      if (error) next(new HttpError(404, "Image not found"));
    });
  });
  app.get("/api/public/plots", async (req, res) => {
    const {
      limit,
      offset,
      q,
      block,
      status,
      type,
      facing,
      phase,
      corner,
      minArea,
      maxArea,
      minRoad,
      maxPrice,
    } = z
      .object({
        limit: z.coerce.number().int().min(1).max(600).default(600),
        offset: z.coerce.number().int().min(0).default(0),
        q: z.string().trim().max(100).optional(),
        block: z.string().trim().max(80).optional(),
        status: z
          .enum(["unverified", "available", "reserved", "sold", "blocked"])
          .optional(),
        type: z
          .enum(["not_provided", "residential", "commercial", "mixed"])
          .optional(),
        facing: z.enum(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]).optional(),
        phase: z.string().trim().max(80).optional(),
        corner: z.enum(["yes", "no"]).optional(),
        minArea: z.coerce.number().nonnegative().optional(),
        maxArea: z.coerce.number().nonnegative().optional(),
        minRoad: z.coerce.number().nonnegative().optional(),
        maxPrice: z.coerce.number().nonnegative().optional(),
      })
      .parse(req.query);
    const values = [],
      where = ["p.publication='published'"];
    const add = (expression, value) => {
      values.push(value);
      where.push(expression.replace("?", `$${values.length}`));
    };
    if (q)
      add(
        "position(? in replace(lower(p.number || ' ' || p.block || ' ' || COALESCE(p.data->>'phase','')),' ','')) > 0",
        q.toLowerCase().replace(/\s+/g, ""),
      );
    if (block) add("p.block=?", block);
    if (status) add("p.status=?", status);
    if (type) add("p.data->>'plotType'=?", type);
    if (facing) add("p.data->>'facing'=?", facing);
    if (phase) add("p.data->>'phase'=?", phase);
    if (corner) add("p.data->>'corner'=?", corner === "yes" ? "true" : "false");
    if (minArea != null)
      add(
        "COALESCE((p.data->>'areaSqM')::numeric,(d.data->>'areaSqMApprox')::numeric)>=?",
        minArea,
      );
    if (maxArea != null)
      add(
        "COALESCE((p.data->>'areaSqM')::numeric,(d.data->>'areaSqMApprox')::numeric)<=?",
        maxArea,
      );
    if (minRoad != null)
      add("(p.data->>'roadWidthMetres')::numeric>=?", minRoad);
    if (maxPrice != null) add("p.price_visible AND p.price_inr<=?", maxPrice);
    const from = `FROM plots p JOIN plot_geometry g ON g.plot_id=p.id JOIN draft_cells d ON d.id=g.draft_id LEFT JOIN (SELECT plot_id,max(created_at) AS status_updated_at FROM inventory_status_history GROUP BY plot_id) h ON h.plot_id=p.id WHERE ${where.join(" AND ")}`;
    const rows = (
      await db.query(
        `SELECT p.*,g.draft_id,g.revision_id,d.data AS geometry,h.status_updated_at ${from} ORDER BY p.block,p.number,p.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      )
    ).rows;
    const plots = rows.map(publicPlot);
    res.json({
      plots,
      offset,
      limit,
      total: Number(
        (await db.query(`SELECT count(*) ${from}`, values)).rows[0].count,
      ),
      version: plots.map((p) => `${p.id}:${p.version}`).join("|"),
      demo,
    });
  });
  app.get("/api/public/plots/:id", async (req, res) => {
    uuid.parse(req.params.id);
    const p = await getPlot(db, req.params.id);
    if (!p || p.publication !== "published")
      throw new HttpError(
        404,
        "This plot is not published or is no longer available to view",
      );
    res.json(publicPlot(p));
  });
  app.get("/api/public/geometry", async (req, res) => {
    res.json(await publicGeometry(db, selectedLayout));
  });
  for (const isVisit of [false, true])
    app.post(
      isVisit ? "/api/visit-requests" : "/api/enquiries",
      async (req, res) => {
        const input = contactSchema.parse(req.body);
        if (
          isVisit &&
          (!input.preferredAt || new Date(input.preferredAt) <= new Date())
        )
          throw new HttpError(
            422,
            "Choose a future visit date and time (Asia/Kolkata)",
          );
        await rate(req, "contact", 12);
        const result = await idempotent(
          req,
          isVisit ? "visit" : "enquiry",
          async (tx) => {
            const contexts = [];
            for (const id of input.plotIds) {
              let p;
              if (z.uuid().safeParse(id).success) {
                p = await getPlot(tx, id);
                if (!p || p.publication !== "published")
                  throw new HttpError(
                    409,
                    "A selected plot changed. Reopen the explorer and check it.",
                  );
                contexts.push({
                  id,
                  label: p.number,
                  status: p.status,
                  version: p.version,
                  kind: "approved",
                });
              } else {
                const d = (
                  await tx.query("SELECT data FROM draft_cells WHERE id=$1", [
                    id,
                  ])
                ).rows[0];
                if (!demo || !d)
                  throw new HttpError(422, "Select a published plot");
                contexts.push({
                  id,
                  label: d.data.label,
                  status: "unverified",
                  kind: "draft",
                });
              }
            }
            const id = randomUUID();
            const { website: _, ...privateData } = input;
            await tx.query("INSERT INTO enquiries(id,data) VALUES($1,$2)", [
              id,
              json({
                ...privateData,
                plots: contexts,
                consentVersion: "2026-11-01",
                consentAt: new Date().toISOString(),
              }),
            ]);
            let visitId = null;
            if (isVisit) {
              visitId = randomUUID();
              await tx.query(
                "INSERT INTO visit_requests(id,enquiry_id,preferred_at) VALUES($1,$2,$3)",
                [visitId, id, input.preferredAt],
              );
            }
            await audit(
              tx,
              null,
              isVisit ? "visit.request" : "enquiry.create",
              visitId || id,
              null,
              { reference: id },
              "Visitor consented to contact about this request",
            );
            return {
              reference: id,
              visitId,
              status: isVisit ? "requested" : "received",
              mode: demo ? "local-demo" : "connected",
              message: demo
                ? "Saved to the local development database. No notification was sent."
                : isVisit
                  ? "Visit requested. The team must confirm the slot."
                  : "Enquiry accepted by the server. No plot is reserved.",
            };
          },
        );
        res.status(201).json(result);
      },
    );
  app.post("/api/auth/login", async (req, res) => {
    await rate(req, "login", 10);
    const input = z
      .object({ email: z.email(), password: z.string().min(1).max(256) })
      .strict()
      .parse(req.body);
    const user = (
      await db.query("SELECT * FROM users WHERE email=$1 AND active=true", [
        input.email.toLowerCase(),
      ])
    ).rows[0];
    // Always perform a password derivation, including unknown accounts.
    const valid = await checkPassword(
      input.password,
      user?.password_hash || `${"0".repeat(32)}:${"0".repeat(128)}`,
    );
    if (!user || !valid)
      throw new HttpError(401, "Email or password is incorrect");
    const token = randomBytes(32).toString("hex"),
      csrf = randomBytes(24).toString("hex");
    await db.query(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",
      [hash(token), user.id, csrf],
    );
    res.cookie("sm_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: production,
      maxAge: 8 * 3600000,
      path: "/api",
    });
    res.json({ id: user.id, name: user.name, role: user.role, csrf });
  });
  app.get("/api/auth/session", (req, res) => {
    if (!req.user) throw new HttpError(401, "Sign in first");
    res.json(req.user);
  });
  app.post("/api/admin/logout", async (req, res) => {
    if (req.user) {
      await db.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
    }
    res.clearCookie("sm_session", {
      path: "/api",
      sameSite: "strict",
      secure: production,
      httpOnly: true,
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/password", async (req, res) => {
    const v = z
      .object({
        currentPassword: z.string().min(1).max(256),
        newPassword: z.string().min(14).max(256),
      })
      .strict()
      .parse(req.body);
    await rate(req, "password", 5);
    const row = (
      await db.query("SELECT password_hash FROM users WHERE id=$1", [
        req.user.id,
      ])
    ).rows[0];
    if (!(await checkPassword(v.currentPassword, row.password_hash)))
      throw new HttpError(401, "Current password is incorrect");
    const encoded = await passwordHash(v.newPassword);
    await db.transaction(async (tx) => {
      await tx.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        encoded,
        req.user.id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [req.user.id]);
      await audit(
        tx,
        req.user,
        "user.password",
        req.user.id,
        null,
        null,
        "Staff member changed password; sessions revoked",
      );
    });
    res.clearCookie("sm_session", { path: "/api" });
    res.json({ ok: true });
  });
  app.post(
    "/api/admin/users/:id/reset-password",
    auth("access"),
    async (req, res) => {
      uuid.parse(req.params.id);
      const v = z
        .object({ newPassword: z.string().min(14).max(256), reason })
        .strict()
        .parse(req.body);
      const encoded = await passwordHash(v.newPassword);
      await db.transaction(async (tx) => {
        const r = await tx.query(
          "UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING id",
          [encoded, req.params.id],
        );
        if (!r.rows.length) throw new HttpError(404, "User not found");
        await tx.query("DELETE FROM sessions WHERE user_id=$1", [
          req.params.id,
        ]);
        await audit(
          tx,
          req.user,
          "user.password-reset",
          req.params.id,
          null,
          null,
          v.reason,
        );
      });
      res.json({ ok: true });
    },
  );
  app.get("/api/admin/overview", async (req, res) => {
    if (!req.user) throw new HttpError(401, "Sign in first");
    const counts = {
      published: Number(
        (
          await db.query(
            "SELECT count(*) FROM plots WHERE publication='published'",
          )
        ).rows[0].count,
      ),
      drafts: Number(
        (await db.query("SELECT count(*) FROM plots WHERE publication='draft'"))
          .rows[0].count,
      ),
    };
    if (can(req.user.role, "leads")) {
      counts.newEnquiries = Number(
        (await db.query("SELECT count(*) FROM enquiries WHERE stage='new'"))
          .rows[0].count,
      );
      counts.dueFollowUps = Number(
        (
          await db.query(
            "SELECT count(*) FROM enquiries WHERE stage <> 'closed' AND next_action_at IS NOT NULL AND next_action_at <= now()",
          )
        ).rows[0].count,
      );
      counts.requestedVisits = Number(
        (
          await db.query(
            "SELECT count(*) FROM visit_requests WHERE status='requested'",
          )
        ).rows[0].count,
      );
      counts.confirmedVisits = Number(
        (
          await db.query(
            "SELECT count(*) FROM visit_requests WHERE status='confirmed'",
          )
        ).rows[0].count,
      );
    }
    res.json({
      mode: demo ? "local-demo" : "connected",
      role: req.user.role,
      counts,
    });
  });
  app.get("/api/admin/review", auth("review"), async (req, res) => {
    res.json({
      cells: (
        await db.query(
          "SELECT d.*,g.plot_id FROM draft_cells d LEFT JOIN plot_geometry g ON g.draft_id=d.id ORDER BY d.id",
        )
      ).rows,
    });
  });
  app.get("/api/admin/plots", async (req, res) => {
    if (!req.user) throw new HttpError(401, "Sign in first");
    const list = (
      await db.query(
        "SELECT p.*,g.draft_id,g.revision_id,d.data AS geometry FROM plots p JOIN plot_geometry g ON g.plot_id=p.id JOIN draft_cells d ON d.id=g.draft_id ORDER BY p.block,p.number",
      )
    ).rows;
    res.json({ plots: list });
  });
  app.post("/api/admin/reconcile", auth("review"), async (req, res) => {
    const input = z
      .object({ draftId: z.string().max(150), data: approvedDataSchema })
      .strict()
      .parse(req.body);
    res
      .status(201)
      .json(
        await idempotent(req, `reconcile:${req.user.id}`, (tx) =>
          approveDraft(tx, req.user, input.draftId, input.data),
        ),
      );
  });
  app.patch("/api/admin/plots/:id", async (req, res) => {
    uuid.parse(req.params.id);
    res.json(
      await idempotent(req, `plot:${req.user.id}:${req.params.id}`, (tx) =>
        updatePlot(tx, req.user, req.params.id, req.body),
      ),
    );
  });
  app.get("/api/admin/enquiries", auth("leads"), async (req, res) => {
    const { limit, offset } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(req.query);
    res.json({
      enquiries: (
        await db.query(
          "SELECT * FROM enquiries ORDER BY created_at DESC,id DESC LIMIT $1 OFFSET $2",
          [limit, offset],
        )
      ).rows,
      visits: (
        await db.query(
          "SELECT v.*,e.data AS enquiry_data FROM visit_requests v JOIN enquiries e ON e.id=v.enquiry_id ORDER BY v.preferred_at DESC,v.id DESC LIMIT $1 OFFSET $2",
          [limit, offset],
        )
      ).rows,
      enquiriesTotal: Number(
        (await db.query("SELECT count(*) FROM enquiries")).rows[0].count,
      ),
      visitsTotal: Number(
        (await db.query("SELECT count(*) FROM visit_requests")).rows[0].count,
      ),
      staff: (
        await db.query(
          "SELECT id,name FROM users WHERE active=true AND role IN ('owner','administrator','sales') ORDER BY name,id",
        )
      ).rows,
      limit,
      offset,
    });
  });
  app.patch("/api/admin/enquiries/:id", auth("leads"), async (req, res) => {
    uuid.parse(req.params.id);
    const change = z
      .object({
        expectedVersion: z.number().int(),
        stage: z.enum(["new", "contacted", "qualified", "closed"]),
        notes: z.string().max(4000),
        assignedTo: uuid.nullable(),
        nextActionAt: z.string().datetime({ offset: true }).nullable(),
        reason,
      })
      .strict()
      .parse(req.body);
    res.json(
      await idempotent(
        req,
        `lead:${req.user.id}:${req.params.id}`,
        async (tx) => {
          const old = (
            await tx.query("SELECT * FROM enquiries WHERE id=$1", [
              req.params.id,
            ])
          ).rows[0];
          if (!old) throw new HttpError(404, "Enquiry not found");
          if (change.assignedTo) {
            const assignee = (
              await tx.query(
                "SELECT role FROM users WHERE id=$1 AND active=true",
                [change.assignedTo],
              )
            ).rows[0];
            if (!assignee || !can(assignee.role, "leads"))
              throw new HttpError(
                422,
                "Assignee must be active sales staff or an administrator",
              );
          }
          const r = await tx.query(
            "UPDATE enquiries SET stage=$1,notes=$2,assigned_to=$3,next_action_at=$4,version=version+1 WHERE id=$5 AND version=$6 RETURNING *",
            [
              change.stage,
              change.notes,
              change.assignedTo,
              change.nextActionAt,
              req.params.id,
              change.expectedVersion,
            ],
          );
          if (!r.rows.length)
            throw new HttpError(409, "Enquiry changed; reload it");
          // Audit lead operations without duplicating buyer contact/notes in permanent history.
          await audit(
            tx,
            req.user,
            "enquiry.update",
            req.params.id,
            {
              stage: old.stage,
              assignedTo: old.assigned_to,
              nextActionAt: old.next_action_at,
            },
            {
              stage: change.stage,
              assignedTo: change.assignedTo,
              nextActionAt: change.nextActionAt,
              notesChanged: old.notes !== change.notes,
            },
            change.reason,
          );
          return r.rows[0];
        },
      ),
    );
  });
  app.patch("/api/admin/visits/:id", auth("leads"), async (req, res) => {
    uuid.parse(req.params.id);
    const change = z
      .object({
        expectedVersion: z.number().int(),
        status: z.enum(visitStatuses),
        scheduledAt: z.string().datetime({ offset: true }).nullable(),
        reason,
      })
      .strict()
      .parse(req.body);
    const allowed = {
      requested: ["contacted", "confirmed", "cancelled"],
      contacted: ["confirmed", "rescheduled", "cancelled"],
      confirmed: ["completed", "no_show", "rescheduled", "cancelled"],
      rescheduled: ["confirmed", "completed", "no_show", "cancelled"],
      completed: [],
      no_show: [],
      cancelled: [],
    };
    res.json(
      await idempotent(
        req,
        `visit-edit:${req.user.id}:${req.params.id}`,
        async (tx) => {
          const old = (
            await tx.query("SELECT * FROM visit_requests WHERE id=$1", [
              req.params.id,
            ])
          ).rows[0];
          if (!old) throw new HttpError(404, "Visit not found");
          if (!allowed[old.status].includes(change.status))
            throw new HttpError(
              422,
              `Cannot change ${old.status} to ${change.status}`,
            );
          if (
            ["confirmed", "rescheduled", "completed", "no_show"].includes(
              change.status,
            ) &&
            !change.scheduledAt
          )
            throw new HttpError(422, "An agreed slot is required");
          if (
            ["confirmed", "rescheduled"].includes(change.status) &&
            new Date(change.scheduledAt) <= new Date()
          )
            throw new HttpError(422, "Choose a future agreed slot");
          if (
            ["completed", "no_show"].includes(change.status) &&
            (!old.scheduled_at ||
              new Date(change.scheduledAt).getTime() !==
                new Date(old.scheduled_at).getTime())
          )
            throw new HttpError(
              422,
              "An outcome must use the existing agreed slot",
            );
          if (
            change.status === "no_show" &&
            new Date(old.scheduled_at) > new Date()
          )
            throw new HttpError(
              422,
              "A future visit cannot yet be marked no-show",
            );
          const r = await tx.query(
            "UPDATE visit_requests SET status=$1,scheduled_at=$2,version=version+1 WHERE id=$3 AND version=$4 RETURNING *",
            [
              change.status,
              change.scheduledAt,
              req.params.id,
              change.expectedVersion,
            ],
          );
          if (!r.rows.length)
            throw new HttpError(409, "Visit changed; reload it");
          await audit(
            tx,
            req.user,
            "visit.update",
            req.params.id,
            old,
            r.rows[0],
            change.reason,
          );
          return r.rows[0];
        },
      ),
    );
  });
  app.get("/api/admin/audit", auth("audit"), async (req, res) => {
    const { limit, offset, entity } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        entity: z.string().trim().max(150).optional(),
      })
      .parse(req.query);
    res.json({
      events: (
        await db.query(
          "SELECT a.*,u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON a.actor_id=u.id WHERE ($1::text IS NULL OR entity_id=$1) ORDER BY a.created_at DESC,a.id DESC LIMIT $2 OFFSET $3",
          [entity || null, limit, offset],
        )
      ).rows,
      total: Number(
        (
          await db.query(
            "SELECT count(*) FROM audit_logs WHERE ($1::text IS NULL OR entity_id=$1)",
            [entity || null],
          )
        ).rows[0].count,
      ),
      limit,
      offset,
    });
  });
  app.get("/api/admin/content", auth("content"), async (req, res) =>
    res.json({
      items: (await db.query("SELECT * FROM content ORDER BY kind,id")).rows,
    }),
  );
  app.get("/api/admin/presentation", auth("content"), async (req, res) => {
    const item =
      (
        await db.query(
          "SELECT * FROM content WHERE id='illustrated-layout' AND kind='presentation'",
        )
      ).rows[0] || null;
    const plots = (
      await db.query(
        "SELECT p.id,p.number,p.block,p.publication,g.draft_id,d.data AS geometry FROM plots p JOIN plot_geometry g ON g.plot_id=p.id JOIN draft_cells d ON d.id=g.draft_id ORDER BY p.block,p.number",
      )
    ).rows;
    res.json({ item, plots });
  });
  app.post(
    "/api/admin/amenity-references/stage",
    auth("content"),
    async (req, res) => {
      if (sourceBundle !== "public/data/layout.json") throw new HttpError(404, "Reference set unavailable");
      const input = z.object({ reason }).strict().parse(req.body);
      res.json(
        await idempotent(
          req,
          `amenity-references:${req.user.id}`,
          async (tx) => {
            const created = [],
              existing = [];
            for (const ref of ownerAmenityReferences) {
              if (!referenceContains(selectedLayout, ref, ref.mapPoint))
                throw new HttpError(500, "Reference area mismatch");
              const draft = contentSchemas.amenity.parse({
                title: ref.title,
                titleHi: ref.titleHi,
                category: ref.category,
                description:
                  ref.description ||
                  "Owner-indicated area. Exact placement and current status need confirmation.",
                descriptionHi:
                  ref.descriptionHi ||
                  "स्वामी द्वारा संकेतित क्षेत्र। सटीक स्थान और वर्तमान स्थिति की पुष्टि बाकी है।",
                location: planToGeographic(ref.mapPoint, selectedLayout),
                placementPrecision: "approximate",
                visualScale: 1,
                visualRotation: ref.visualRotation,
                customerVisible: false,
                imageUrl: ref.image ? `/assets/concepts/${ref.image}` : "",
                imageKind: "concept",
                state: ref.state || "confirmation_pending",
                source: ref.source || OWNER_AMENITY_SOURCE,
                verifiedAt: null,
              });
              const saved = await tx.query(
                "INSERT INTO content(id,kind,draft) VALUES($1,'amenity',$2) ON CONFLICT(id) DO NOTHING RETURNING id",
                [ref.id, json(draft)],
              );
              if (!saved.rows.length) {
                existing.push(ref.id);
                continue;
              }
              created.push(ref.id);
              await audit(
                tx,
                req.user,
                "amenity.reference.stage",
                ref.id,
                null,
                { draft },
                input.reason,
              );
            }
            return { created, existing };
          },
        ),
      );
    },
  );
  app.put(
    "/api/admin/content/visitor-entrance/footprint",
    auth("content"),
    async (req, res) => {
      const body = z
        .object({
          footprint: siteAccessFootprintSchema,
          expectedVersion: z.number().int().min(1),
          reason,
        })
        .strict()
        .parse(req.body);
      res.json(
        await idempotent(
          req,
          `site-access-footprint:${req.user.id}`,
          async (tx) => {
            const old = (
              await tx.query("SELECT * FROM content WHERE id=$1", [
                "visitor-entrance",
              ])
            ).rows[0];
            if (!old || old.kind !== "site_access")
              throw new HttpError(
                404,
                "Save visitor access before staging a footprint",
              );
            if (old.version !== body.expectedVersion)
              throw new HttpError(409, "Content changed; reload it");
            const assessment = await assessAccessFootprint(body.footprint, tx, selectedLayout);
            const draft = contentSchemas.site_access.parse({
              ...old.draft,
              footprint: body.footprint,
            });
            const updated = (
              await tx.query(
                "UPDATE content SET draft=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=$3 RETURNING *",
                [json(draft), "visitor-entrance", body.expectedVersion],
              )
            ).rows[0];
            if (!updated)
              throw new HttpError(409, "Content changed; reload it");
            await audit(
              tx,
              req.user,
              "site_access.footprint.stage",
              "visitor-entrance",
              old,
              updated,
              body.reason,
            );
            return { ...updated, footprintAssessment: assessment };
          },
        ),
      );
    },
  );
  app.post("/api/admin/content/:id/unpublish", auth("publish"), async (req, res) => {
    if (!/^[a-z0-9-]{1,80}$/.test(req.params.id))
      throw new HttpError(422, "Use a short lowercase content ID");
    const body = z.object({ expectedVersion: z.number().int().positive(), reason }).strict().parse(req.body);
    res.json(await idempotent(req, `content:${req.user.id}:${req.params.id}`, async (tx) => {
      const old = (await tx.query("SELECT * FROM content WHERE id=$1", [req.params.id])).rows[0];
      if (!old || !["structure", "site_access"].includes(old.kind))
        throw new HttpError(404, "Publishable feature not found");
      if (old.version !== body.expectedVersion)
        throw new HttpError(409, "Content changed; reload it");
      if (old.published === null)
        throw new HttpError(409, "Feature is not published");
      const updated = (await tx.query(
        "UPDATE content SET published=NULL,version=version+1,updated_at=now() WHERE id=$1 AND kind IN ('structure','site_access') AND version=$2 AND published IS NOT NULL RETURNING *",
        [req.params.id, body.expectedVersion],
      )).rows[0];
      if (!updated) throw new HttpError(409, "Content changed; reload it");
      await audit(tx, req.user, `${old.kind}.unpublish`, req.params.id, old, updated, body.reason);
      return updated;
    }));
  });
  app.put("/api/admin/content/:id", auth("content"), async (req, res) => {
    const body = z
      .object({
        kind: z.enum([
          "setting",
          "amenity",
          "media",
          "nearby",
          "presentation",
          "site_access",
          "structure",
        ]),
        data: z.unknown(),
        expectedVersion: z.number().int().min(0),
        publish: z.boolean(),
        reason,
      })
      .strict()
      .parse(req.body);
    const data = contentSchemas[body.kind].parse(body.data);
    const reference = sourceBundle === "public/data/layout.json" ? referenceFor(req.params.id) : null;
    if (reference && body.kind !== "amenity")
      throw new HttpError(
        422,
        "This ID is reserved for its owner-indicated amenity",
      );
    if (
      reference &&
      data.location &&
      !referenceContains(
        selectedLayout,
        reference,
        geographicToPlan(data.location, selectedLayout),
      )
    )
      throw new HttpError(
        422,
        "Keep this marker inside the owner-indicated plan area; review an amended source if the area changes.",
      );
    if (!/^[a-z0-9-]{1,80}$/.test(req.params.id))
      throw new HttpError(422, "Use a short lowercase content ID");
    if (body.kind === "setting" && req.params.id !== "project")
      throw new HttpError(422, "Project settings use the project ID");
    if (
      (body.kind === "site_access") !==
      (req.params.id === "visitor-entrance")
    )
      throw new HttpError(
        422,
        "The visitor-entrance ID is reserved for reviewed site access",
      );
    if (
      (body.kind === "presentation") !==
      (req.params.id === "illustrated-layout")
    )
      throw new HttpError(
        422,
        "The illustrated-layout ID is reserved for presentation settings",
      );
    if (body.publish) {
      requirePermission(req.user, "publish");
      if (
        body.kind === "site_access" &&
        !reviewedVisitorAccess([
          { id: req.params.id, kind: body.kind, published: data },
        ])
      )
        throw new HttpError(
          422,
          "Review existing visitor access coordinates, visibility, source revision and date before publication",
        );
      if (body.kind === "setting" ? !data.verified : !data.verifiedAt)
        throw new HttpError(
          422,
          "Confirm source and verification before publishing",
        );
    }
    res.json(
      await idempotent(
        req,
        `content:${req.user.id}:${req.params.id}`,
        async (tx) => {
          const old = (
            await tx.query("SELECT * FROM content WHERE id=$1", [req.params.id])
          ).rows[0];
          if ((old?.version || 0) !== body.expectedVersion)
            throw new HttpError(409, "Content changed; reload it");
          if (old && old.kind !== body.kind)
            throw new HttpError(422, "Content kind cannot change");
          if (body.kind === "site_access" && data.footprint && !body.publish &&
              (!old || !(await tx.query("SELECT $1::jsonb = $2::jsonb AS same", [json(old.draft.footprint ?? null),json(data.footprint)])).rows[0].same))
            throw new HttpError(422,"Use the footprint staging action to change the footprint");
          let structureAssessment;
          if (body.kind === "structure") {
            if (body.publish) assessModelBinding(data, selectedLayout);
            if (body.publish && (!old || !(await tx.query("SELECT $1::jsonb = $2::jsonb AS same", [json(old.draft), json(data)])).rows[0].same))
              throw new HttpError(422, "Save the structure draft before reviewing and publishing it");
            structureAssessment = await assessStructure(data, req.params.id, tx, selectedLayout);
          }
          if (body.kind === "site_access" && body.publish) {
            assessGateBinding(data, selectedLayout);
            if (data.footprint) await assessAccessFootprint(data.footprint, tx, selectedLayout);
          }
          if (
            body.kind === "site_access" &&
            data.footprint &&
            body.publish &&
            (!old ||
              !(
                await tx.query("SELECT $1::jsonb = $2::jsonb AS same", [
                  json(old.draft),
                  json(data),
                ])
              ).rows[0].same)
          )
            throw new HttpError(
              422,
              "Save the footprint draft before reviewing and publishing it",
            );
          if (body.kind === "presentation") {
            if (
              body.publish &&
              (!old ||
                !(
                  await tx.query("SELECT $1::jsonb = $2::jsonb AS same", [
                    json(old.draft),
                    json(data),
                  ])
                ).rows[0].same)
            )
              throw new HttpError(
                422,
                "Save the presentation draft before reviewing and publishing it",
              );
            const records = (
              await tx.query(
                "SELECT p.id,p.publication,g.draft_id,d.data AS geometry FROM plots p JOIN plot_geometry g ON g.plot_id=p.id JOIN draft_cells d ON d.id=g.draft_id",
              )
            ).rows;
            const byId = new Map(records.map((record) => [record.id, record]));
            for (const placement of data.placements) {
              const record = byId.get(placement.plotId);
              if (!record || record.draft_id !== placement.geometryId)
                throw new HttpError(
                  422,
                  "Plot mapping changed or is unknown; review it again",
                );
              if (!presentationPlacementValid(record.geometry, placement))
                throw new HttpError(
                  422,
                  "A visual placement has invalid presentation coordinates",
                );
              if (body.publish && record.publication !== "published")
                throw new HttpError(
                  422,
                  "Publish the reviewed plot before its visual placement",
                );
            }
          }
          const r = old
            ? await tx.query(
                "UPDATE content SET draft=$1,published=$2,version=version+1,updated_at=now() WHERE id=$3 AND version=$4 RETURNING *",
                [
                  json(data),
                  body.publish
                    ? json(data)
                    : (body.kind === "presentation" || body.kind === "structure" || body.kind === "site_access") && old.published
                      ? json(old.published)
                      : null,
                  req.params.id,
                  body.expectedVersion,
                ],
              )
            : await tx.query(
                "INSERT INTO content(id,kind,draft,published) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING *",
                [
                  req.params.id,
                  body.kind,
                  json(data),
                  body.publish ? json(data) : null,
                ],
              );
          if (!r.rows.length)
            throw new HttpError(409, "Content changed; reload it");
          await audit(
            tx,
            req.user,
            "content.update",
            req.params.id,
            old,
            r.rows[0],
            body.reason,
          );
          return structureAssessment ? { ...r.rows[0], structureAssessment } : r.rows[0];
        },
      ),
    );
  });
  app.get("/api/admin/users", auth("access"), async (req, res) =>
    res.json({
      users: (
        await db.query(
          "SELECT id,email,name,role,active FROM users ORDER BY name",
        )
      ).rows,
    }),
  );
  app.post("/api/admin/users", auth("access"), async (req, res) => {
    const v = z
      .object({
        email: z.email(),
        name: z.string().min(2).max(100),
        password: z.string().min(14).max(256),
        role: z.enum(roles),
      })
      .strict()
      .parse(req.body);
    const id = await db.transaction(async (tx) => {
      const id = await createUser(tx, v);
      await audit(
        tx,
        req.user,
        "user.create",
        id,
        null,
        { email: v.email, role: v.role },
        "Owner created staff access",
      );
      return id;
    });
    res.status(201).json({ id });
  });
  app.patch("/api/admin/users/:id", auth("access"), async (req, res) => {
    uuid.parse(req.params.id);
    const v = z
      .object({ role: z.enum(roles), active: z.boolean(), reason })
      .strict()
      .parse(req.body);
    if (req.params.id === req.user.id)
      throw new HttpError(
        422,
        "Use another owner account to change your own access",
      );
    await db.transaction(async (tx) => {
      const old = (
        await tx.query("SELECT id,role,active FROM users WHERE id=$1", [
          req.params.id,
        ])
      ).rows[0];
      if (!old) throw new HttpError(404, "User not found");
      await tx.query("UPDATE users SET role=$1,active=$2 WHERE id=$3", [
        v.role,
        v.active,
        req.params.id,
      ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [req.params.id]);
      await audit(tx, req.user, "user.access", req.params.id, old, v, v.reason);
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/imports/preview", auth("review"), async (req, res) => {
    const csv = z.string().min(1).max(200000).parse(req.body.csv);
    let rows;
    try {
      rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true });
    } catch {
      throw new HttpError(422, "Malformed CSV");
    }
    if (rows.length > 600) throw new HttpError(422, "Use at most 600 rows");
    const errors = [],
      valid = [],
      seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        // Template source fields are evidence, never trusted authorisation. Imports stage identities only.
        if (
          (r.availability && r.availability !== "unverified") ||
          r.priceINR ||
          r.frontageFeet ||
          r.depthFeet
        )
          throw Error(
            "Import identities only; review inventory and named sides separately",
          );
        if (r.approvedPlotId)
          throw Error(
            "Existing IDs are immutable; update their records in Inventory",
          );
        if (!r.ownerReviewedAt || Number.isNaN(Date.parse(r.ownerReviewedAt)))
          throw Error("A valid ownerReviewedAt date is required");
        const data = approvedDataSchema.parse({
          number: r.approvedPlotNumber,
          block: r.approvedBlock,
          sourceDocument: sourceBundle === "public/data/layout.json" ? "Supplied north-oriented PDF" : r.sourceDocument,
          sourceRevision: r.surveyDocumentRevision,
          reviewNote: r.notes,
          areaSqM: r.verifiedAreaSqFt
            ? Number(r.verifiedAreaSqFt) * 0.09290304
            : null,
          areaSourceText: r.verifiedAreaSqFt
            ? `${r.verifiedAreaSqFt} sq ft`
            : "",
        });
        const key = `${data.block}|${data.number}`;
        if (seen.has(key) || seen.has(r.draftGeometryId))
          throw Error("Duplicate identity or geometry in this CSV");
        seen.add(key);
        seen.add(r.draftGeometryId);
        const draftCell = (
          await db.query("SELECT data FROM draft_cells WHERE id=$1", [
            r.draftGeometryId,
          ])
        ).rows[0];
        if (!draftCell) throw Error("Unknown draftGeometryId");
        if (r.sourceBlock && r.sourceBlock !== draftCell.data.block)
          throw Error("sourceBlock does not match the original plan reference");
        if (
          (
            await db.query(
              "SELECT plot_id FROM plot_geometry WHERE draft_id=$1",
              [r.draftGeometryId],
            )
          ).rows.length
        )
          throw Error(
            "Geometry is already mapped; existing approved IDs are preserved",
          );
        if (
          (
            await db.query(
              "SELECT id FROM plots WHERE block=$1 AND number=$2",
              [data.block, data.number],
            )
          ).rows.length
        )
          throw Error("Approved number already exists in this block");
        valid.push({ draftId: r.draftGeometryId, data });
      } catch (e) {
        errors.push({
          row: i + 2,
          message:
            e instanceof z.ZodError
              ? e.issues
                  .map((x) => `${x.path.join(".")}: ${x.message}`)
                  .join("; ")
              : e.message,
        });
      }
    }
    const id = randomUUID();
    await db.query(
      "INSERT INTO import_previews(id,actor_id,rows,errors,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",
      [id, req.user.id, json(valid), json(errors)],
    );
    res.json({
      id,
      total: rows.length,
      valid: valid.length,
      errors,
      rows: valid,
    });
  });
  app.post("/api/admin/imports/commit", auth("review"), async (req, res) => {
    const id = uuid.parse(req.body.previewId);
    res.json(
      await idempotent(req, `import:${req.user.id}`, async (tx) => {
        const p = (
          await tx.query(
            "SELECT * FROM import_previews WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!p || p.actor_id !== req.user.id)
          throw new HttpError(404, "Preview not found");
        if (
          p.committed ||
          new Date(p.expires_at) < new Date() ||
          p.errors.length
        )
          throw new HttpError(
            409,
            "Preview expired, committed or contains errors",
          );
        const ids = [];
        for (const row of p.rows)
          ids.push(
            (await approveDraft(tx, req.user, row.draftId, row.data)).id,
          );
        await tx.query(
          "UPDATE import_previews SET committed=true WHERE id=$1",
          [id],
        );
        await audit(
          tx,
          req.user,
          "import.commit",
          id,
          null,
          { ids },
          "Validated CSV identities staged as drafts",
        );
        return { ids, publication: "draft" };
      }),
    );
  });
  app.get(
    "/api/admin/inventory-imports/template",
    auth("inventory"),
    async (req, res) => {
      const rows = (
        await db.query(
          "SELECT id,version FROM plots WHERE publication <> 'archived' ORDER BY block,number,id",
        )
      ).rows;
      res
        .type("text/csv")
        .set(
          "Content-Disposition",
          'attachment; filename="inventory-update.csv"',
        )
        .send(
          [
            "approvedPlotId,expectedVersion,status,priceINR,priceVisible,reason",
            ...rows.map((row) => `${row.id},${row.version},,,,`),
          ].join("\n") + "\n",
        );
    },
  );
  app.post(
    "/api/admin/inventory-imports/preview",
    auth("inventory"),
    async (req, res) => {
      const csv = z.string().min(1).max(200000).parse(req.body.csv);
      let rows;
      try {
        rows = parse(csv, {
          columns: (headers) => {
            const allowed = [
              "approvedPlotId",
              "expectedVersion",
              "status",
              "priceINR",
              "priceVisible",
              "reason",
            ];
            if (
              new Set(headers).size !== headers.length ||
              headers.some((h) => !allowed.includes(h)) ||
              !["approvedPlotId", "expectedVersion", "reason"].every((h) =>
                headers.includes(h),
              )
            )
              throw Error(
                "CSV headers must match the inventory template without duplicates",
              );
            return headers;
          },
          skip_empty_lines: true,
          bom: true,
          trim: true,
        });
      } catch (e) {
        throw new HttpError(
          422,
          e.message.includes("CSV headers") ? e.message : "Malformed CSV",
        );
      }
      if (!rows.length || rows.length > 600)
        throw new HttpError(422, "Use 1–600 data rows");
      const errors = [],
        valid = [],
        seen = new Set();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const plotId = uuid.parse(row.approvedPlotId);
          if (seen.has(plotId))
            throw Error("Duplicate approved plot ID in this CSV");
          seen.add(plotId);
          if (!/^[1-9]\d*$/.test(row.expectedVersion || ""))
            throw Error("A positive expectedVersion is required");
          if (row.priceVisible && !["true", "false"].includes(row.priceVisible))
            throw Error("priceVisible must be true, false or blank");
          const change = plotEditSchema.parse({
            expectedVersion: Number(row.expectedVersion),
            reason: row.reason,
            ...(row.status ? { status: row.status } : {}),
            ...(row.priceINR
              ? {
                  priceINR:
                    row.priceINR === "clear" ? null : Number(row.priceINR),
                }
              : {}),
            ...(row.priceVisible
              ? { priceVisible: row.priceVisible === "true" }
              : {}),
          });
          if (
            change.status === undefined &&
            change.priceINR === undefined &&
            change.priceVisible === undefined
          )
            throw Error("Provide a status, price or price visibility change");
          const current = await getPlot(db, plotId);
          if (!current) throw Error("Approved plot ID was not found");
          if (current.version !== change.expectedVersion)
            throw Error(
              "Version changed; export current inventory and review again",
            );
          if (
            change.status &&
            change.status !== "unverified" &&
            !current.verified_at
          )
            throw Error("Review the identity before setting inventory status");
          if (
            (change.priceVisible ?? current.price_visible) &&
            (change.priceINR === undefined
              ? current.price_inr
              : change.priceINR) == null
          )
            throw Error("A visible price needs a price value");
          valid.push({
            kind: "inventory",
            plotId,
            number: current.number,
            block: current.block,
            before: {
              status: current.status,
              priceINR: current.price_inr,
              priceVisible: current.price_visible,
            },
            change,
          });
        } catch (e) {
          errors.push({
            row: i + 2,
            message:
              e instanceof z.ZodError
                ? e.issues
                    .map((x) => `${x.path.join(".")}: ${x.message}`)
                    .join("; ")
                : e.message,
          });
        }
      }
      const id = randomUUID();
      await db.query(
        "INSERT INTO import_previews(id,actor_id,rows,errors,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 minutes')",
        [id, req.user.id, json(valid), json(errors)],
      );
      res.json({
        id,
        total: rows.length,
        valid: valid.length,
        errors,
        rows: valid,
      });
    },
  );
  app.post(
    "/api/admin/inventory-imports/commit",
    auth("inventory"),
    async (req, res) => {
      const id = uuid.parse(req.body.previewId);
      res.json(
        await idempotent(req, `inventory-import:${req.user.id}`, async (tx) => {
          const p = (
            await tx.query(
              "SELECT * FROM import_previews WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!p || p.actor_id !== req.user.id)
            throw new HttpError(404, "Preview not found");
          if (
            p.committed ||
            new Date(p.expires_at) < new Date() ||
            p.errors.length ||
            !p.rows.length ||
            p.rows.some((row) => row.kind !== "inventory")
          )
            throw new HttpError(
              409,
              "Preview expired, committed, invalid or contains errors",
            );
          const ids = [];
          for (const row of p.rows) {
            await updatePlot(tx, req.user, row.plotId, row.change);
            ids.push(row.plotId);
          }
          await tx.query(
            "UPDATE import_previews SET committed=true WHERE id=$1",
            [id],
          );
          await audit(
            tx,
            req.user,
            "inventory-import.commit",
            id,
            null,
            { ids },
            "Validated inventory CSV committed atomically",
          );
          return { ids, updated: ids.length };
        }),
      );
    },
  );
  app.get("/api/admin/export", auth("review"), async (req, res) =>
    res.json({
      plots: (
        await db.query(
          "SELECT id,number,block,publication,status,version,data FROM plots",
        )
      ).rows,
      mappings: (await db.query("SELECT * FROM plot_geometry")).rows,
    }),
  );
  app.post("/api/admin/geometry-revisions", auth("review"), async (req, res) =>
    res
      .status(201)
      .json(
        await idempotent(req, `geometry-stage:${req.user.id}`, (tx) =>
          stageGeometry(tx, req.user, req.body, { layout: selectedLayout, sourceBundle }),
        ),
      ),
  );
  app.get("/api/admin/geometry-proposals", auth("review"), async (req, res) =>
    res.json({
      proposals: (
        await db.query(
          "SELECT * FROM geometry_proposals ORDER BY created_at DESC",
        )
      ).rows,
    }),
  );
  app.post(
    "/api/admin/geometry-proposals",
    auth("review"),
    async (req, res) => {
      const v = z
        .object({
          plotId: uuid,
          draftId: z.string().max(150),
          expectedVersion: z.number().int().positive(),
          reason,
        })
        .strict()
        .parse(req.body);
      const id = randomUUID();
      await db.transaction(async (tx) => {
        const p = await getPlot(tx, v.plotId);
        if (!p || p.version !== v.expectedVersion)
          throw new HttpError(409, "Reload this plot");
        await tx.query(
          "INSERT INTO geometry_proposals(id,plot_id,draft_id,expected_version,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6)",
          [id, v.plotId, v.draftId, v.expectedVersion, req.user.id, v.reason],
        );
        await audit(tx, req.user, "geometry.propose", id, null, v, v.reason);
      });
      res.status(201).json({ id });
    },
  );
  app.post(
    "/api/admin/geometry-proposals/:id/decide",
    auth("publish"),
    async (req, res) => {
      uuid.parse(req.params.id);
      const v = z
        .object({ approve: z.boolean(), reason })
        .strict()
        .parse(req.body);
      res.json(
        await idempotent(
          req,
          `geometry:${req.user.id}:${req.params.id}`,
          async (tx) => {
            const g = (
              await tx.query(
                "SELECT * FROM geometry_proposals WHERE id=$1 FOR UPDATE",
                [req.params.id],
              )
            ).rows[0];
            if (!g || g.status !== "pending")
              throw new HttpError(409, "Proposal is no longer pending");
            if (v.approve) {
              const p = await getPlot(tx, g.plot_id),
                d = (
                  await tx.query("SELECT * FROM draft_cells WHERE id=$1", [
                    g.draft_id,
                  ])
                ).rows[0];
              if (!p || p.version !== g.expected_version)
                throw new HttpError(
                  409,
                  "Inventory changed; create a fresh proposal",
                );
              const revisedData = {
                ...p.data,
                dimensions: [],
                areaSqM: null,
                areaSourceText: "",
                roadWidthMetres: null,
                facing: null,
                plotType: "not_provided",
                phase: "",
                corner: null,
                parkFacing: null,
                documentIds: [],
              };
              const result = await tx.query(
                "UPDATE plots SET publication='draft',verified_at=NULL,verified_by=NULL,status='unverified',price_visible=false,data=$3,version=version+1,updated_at=now() WHERE id=$1 AND version=$2 RETURNING id",
                [p.id, p.version, json(revisedData)],
              );
              if (!result.rows.length)
                throw new HttpError(409, "Conflicting geometry change");
              await tx.query(
                "UPDATE plot_geometry SET draft_id=$1,revision_id=$2 WHERE plot_id=$3",
                [g.draft_id, d.revision_id, p.id],
              );
              await tx.query("DELETE FROM plot_dimensions WHERE plot_id=$1", [
                p.id,
              ]);
              if (p.status !== "unverified")
                await tx.query(
                  "INSERT INTO inventory_status_history(id,plot_id,old_status,new_status,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6)",
                  [
                    randomUUID(),
                    p.id,
                    p.status,
                    "unverified",
                    req.user.id,
                    v.reason,
                  ],
                );
              if (p.price_visible)
                await tx.query(
                  "INSERT INTO price_records(id,plot_id,amount,visible,changed_by,reason) VALUES($1,$2,$3,false,$4,$5)",
                  [randomUUID(), p.id, p.price_inr, req.user.id, v.reason],
                );
              await audit(
                tx,
                req.user,
                "geometry.reassign",
                p.id,
                {
                  draftId: p.draft_id,
                  revision: p.revision_id,
                  status: p.status,
                  priceVisible: p.price_visible,
                  data: p.data,
                },
                {
                  draftId: g.draft_id,
                  revision: d.revision_id,
                  status: "unverified",
                  priceVisible: false,
                  data: revisedData,
                },
                v.reason,
              );
            }
            await tx.query(
              "UPDATE geometry_proposals SET status=$1 WHERE id=$2",
              [v.approve ? "approved" : "rejected", g.id],
            );
            return { ok: true };
          },
        ),
      );
    },
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API endpoint not found" }),
  );
  if (serveStatic) {
    app.use(express.static(resolve(staticDirectory), { index: false, maxAge: "1h" }));
    app.get("/{*path}", async (req, res) => {
      let html = await readFile(resolve(staticDirectory, "index.html"), "utf8");
      if (googleMaps)
        html = html.replace(
          /<script\b/g,
          `<script nonce="${res.locals.cspNonce}"`,
        );
      const escape = (v) =>
        String(v).replace(
          /[&<>"']/g,
          (c) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[c],
        );
      const siteTitle = `${publicSiteConfig.name} · A thoughtful beginning`;
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${escape(siteTitle)}</title>`)
        .replace(/property="og:title"\s+content="[^"]*"/, `property="og:title" content="${escape(siteTitle)}"`);
      if (sourceAssets.schematic)
        html = html.replace("</head>", `<meta property="og:image" content="${escape(origin + sourceAssets.schematic)}" /></head>`);
      if (req.path.startsWith("/plots/")) {
        const id = req.path.slice(7),
          p = uuid.safeParse(id).success ? await getPlot(db, id) : null;
        const title = plotPageTitle(publicSiteConfig, p);
        if (!p || p.publication !== "published") res.status(404);
        html = html
          .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
          .replace(
            /property="og:title"\s+content="[^"]*"/,
            `property="og:title" content="${escape(title)}"`,
          );
      }
      res.set("Cache-Control", "no-store").type("html").send(html);
    });
  }
  app.use((err, req, res, _next) => {
    const status =
      err instanceof z.ZodError
        ? 422
        : err.status ||
          (["23505", "23503", "23514"].includes(err.code) ? 409 : 500);
    if (logging && status === 500)
      console.error(json({ requestId: req.requestId, error: err.message }));
    res.status(status).json({
      error:
        status === 500
          ? "The server could not complete this request. Please retry."
          : err instanceof z.ZodError
            ? "Please correct the highlighted fields."
            : status === 409 && !err.status
              ? "A conflicting or invalid record exists. Reload and review it."
              : err.message,
      fields:
        err instanceof z.ZodError
          ? Object.fromEntries(
              err.issues.map((x) => [x.path.join("."), x.message]),
            )
          : undefined,
      requestId: req.requestId,
    });
  });
  return app;
}
