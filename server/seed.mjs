import { readFile } from "node:fs/promises";
import { hash } from "./auth.mjs";
export async function seed(db) {
  const raw = await readFile(
      new URL("../public/data/layout.json", import.meta.url),
      "utf8",
    ),
    data = JSON.parse(raw),
    revision = hash(raw);
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES($1,$1,$2) ON CONFLICT DO NOTHING",
      [
        revision,
        JSON.stringify({
          source: "Supplied KML; divider reconstruction",
          projection: "UTM 43N",
          warning: data.warning,
          pdf: "MAHENDRAR JI ALL PDF NORTH.pdf",
          authority: "Supplied PDF after individual owner review",
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
          name: "Shubh Mangal Residency",
          tagline: "A thoughtful beginning. A clearer view.",
          contactPhone: "",
          contactEmail: "",
          entrance: null,
          verified: false,
          source: "Owner confirmation pending",
        },
      ],
      ...[
        "Road network",
        "Water supply",
        "Electricity",
        "Security",
        "Landscaping",
        "Temple",
      ].map((title, i) => [
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
