import { createSiteSource } from "../shared/site-source.mjs";
import { loadSiteLayout, assertSourceDatabase } from "./site-source.mjs";
// Alternate sources are opt-in and do not enable alternate browser startup.
export async function seed(db, { source = createSiteSource() } = {}) {
  const selected = await loadSiteLayout(source);
  source = selected.source;
  const data = selected.layout,
    revision = selected.revision;
  await db.transaction(async (tx) => {
    await assertSourceDatabase(tx, selected, { requireLayoutMatch: false });
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
