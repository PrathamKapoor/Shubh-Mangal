import { publicPlot } from "./inventory.mjs";
import { publicGeometry } from "./public-geometry.mjs";

const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, value[key]]));

// project(tx) must return the existing explicitly public project projection,
// and every query it performs must use tx. No response may be sent inside it.
export async function loadPublicSnapshot(db, layout, project) {
  return db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const publicProject = await project(tx);
    const rows = (await tx.query(`SELECT p.*,g.draft_id,g.revision_id,d.data AS geometry,h.status_updated_at
      FROM plots p JOIN plot_geometry g ON g.plot_id=p.id
      JOIN draft_cells d ON d.id=g.draft_id
      LEFT JOIN (SELECT plot_id,max(created_at) AS status_updated_at FROM inventory_status_history GROUP BY plot_id) h ON h.plot_id=p.id
      WHERE p.publication='published' ORDER BY p.block,p.number,p.id`)).rows;
    const geometry = await publicGeometry(tx, layout);
    geometry.features = geometry.features.map((feature) => ({
      ...feature,
      geometry: pick(feature.geometry, ["type", "coordinates"]),
    }));
    return { project: publicProject, plots: rows.map(publicPlot), geometry };
  });
}
