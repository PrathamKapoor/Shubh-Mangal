import { readFile } from "node:fs/promises";
import { hash } from "./auth.mjs";
import { createSiteSource } from "../shared/site-source.mjs";
import { projectionFromLayout } from "../shared/geography.mjs";
// Alternate sources are opt-in for callers using an isolated database. This
// does not change the server or browser's independently configured layout.
export async function seed(db, { source = createSiteSource() } = {}) {
  source = createSiteSource(source);
  const raw = await readFile(
      new URL(`../${source.layoutFile}`, import.meta.url),
      "utf8",
    ),
    data = JSON.parse(raw),
    revision = hash(raw);
  projectionFromLayout(data);
  if (
    !Array.isArray(data.plots) ||
    !Array.isArray(data.viewBox) ||
    data.viewBox.length !== 4 ||
    !data.viewBox.every(Number.isFinite) ||
    data.viewBox[2] <= 0 ||
    data.viewBox[3] <= 0 ||
    data.plots.some((p) => typeof p?.id !== "string" || !p.id.trim()) ||
    new Set(data.plots.map((p) => p.id)).size !== data.plots.length
  )
    throw new TypeError("Invalid source layout");
  await db.transaction(async (tx) => {
    const prior = (await tx.query("SELECT provenance FROM geometry_revisions")).rows;
    const legacyLayout = createSiteSource().layoutFile;
    if (prior.some(({ provenance }) => (provenance?.sourceBundle || legacyLayout) !== source.layoutFile))
      throw new Error("Database contains a different source bundle; use a separate database");
    await tx.query(
      "INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES($1,$1,$2) ON CONFLICT DO NOTHING",
      [
        revision,
        JSON.stringify({
          ...source.provenance,
          sourceBundle: source.layoutFile,
          warning: data.warning,
          bounds: data.geographicBounds,
          viewBox: data.viewBox,
        }),
      ],
    );
    for (const p of data.plots)
      await tx.query(
        "INSERT INTO draft_cells(id,revision_id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [p.id, revision, JSON.stringify(p)],
      );
    const items = [
      [
        "project",
        "setting",
        {
          name: source.name,
          tagline: "A thoughtful beginning. A clearer view.",
          contactPhone: "",
          contactEmail: "",
          entrance: null,
          verified: false,
          source: "Owner confirmation pending",
        },
      ],
      ...source.amenities.map((title, i) => [
        `amenity-${i}`,
        "amenity",
        {
          title,
          state: "confirmation_pending",
          description:
            "Shown or advertised in supplied source material. Current status requires owner confirmation.",
          source: "Supplied plan / marketing poster",
          verifiedAt: null,
        },
      ]),
    ];
    for (const [id, kind, item] of items)
      await tx.query(
        "INSERT INTO content(id,kind,draft) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, kind, JSON.stringify(item)],
      );
  });
  return { draftCells: data.plots.length, revision, publishedPlots: 0 };
}
