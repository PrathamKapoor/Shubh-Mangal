import { pathToGeographicGeometry } from "../shared/geography.mjs";
import { hash } from "./auth.mjs";

// Only current published mappings enter this query. One statement provides a
// consistent mapping/version snapshot even while staff publish another revision.
export async function publicGeometry(db, layout) {
  const rows = (
    await db.query(`SELECT p.id,p.version,p.status,g.draft_id,g.revision_id,d.data AS geometry
    FROM plots p JOIN plot_geometry g ON g.plot_id=p.id
    JOIN draft_cells d ON d.id=g.draft_id WHERE p.publication='published' ORDER BY p.id`)
  ).rows;
  const features = rows.flatMap((row) => {
    // New revisions retain input WGS84; legacy immutable cells have line paths.
    const geometry =
      row.geometry.geographicGeometry ||
      pathToGeographicGeometry(row.geometry.path, layout);
    if (!geometry) return [];
    return [
      {
        type: "Feature",
        id: row.id,
        properties: {
          featureType: "plot",
          plotId: row.id,
          geometryId: row.draft_id,
          revisionId: row.revision_id,
          version: row.version,
          publication: "published",
          status: row.status,
          provenance: row.geometry.geographicGeometry
            ? "reviewed-input"
            : "legacy-projected-path",
        },
        geometry,
      },
    ];
  });
  return {
    type: "FeatureCollection",
    features,
    snapshot: hash(
      JSON.stringify(
        rows.map((r) => [r.id, r.version, r.draft_id, r.revision_id]),
      ),
    ),
    mappings: rows.map((r) => ({
      plot_id: r.id,
      draft_id: r.draft_id,
      revision_id: r.revision_id,
    })),
  };
}
