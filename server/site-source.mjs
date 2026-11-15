import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createSiteSource } from "../shared/site-source.mjs";
import { projectionFromLayout } from "../shared/geography.mjs";
import { hash } from "./auth.mjs";

export async function loadSiteLayout(input) {
  const source = createSiteSource(input);
  const raw = await readFile(
    new URL(`../${source.layoutFile}`, import.meta.url),
    "utf8",
  );
  const layout = JSON.parse(raw);
  projectionFromLayout(layout);
  if (
    !Array.isArray(layout.plots) ||
    !Array.isArray(layout.viewBox) ||
    layout.viewBox.length !== 4 ||
    !layout.viewBox.every(Number.isFinite) ||
    layout.viewBox[2] <= 0 ||
    layout.viewBox[3] <= 0 ||
    layout.plots.some((p) => typeof p?.id !== "string" || !p.id.trim()) ||
    new Set(layout.plots.map((p) => p.id)).size !== layout.plots.length
  )
    throw new TypeError("Invalid source layout");
  return { source, layout, revision: hash(raw) };
}

// SITE_SOURCE_CONFIG is a JSON file path relative to the process working
// directory (or absolute). Omission retains the original source bundle.
export async function loadSiteSource(configPath = undefined) {
  if (configPath === undefined) return loadSiteLayout();
  if (typeof configPath !== "string" || !configPath.trim())
    throw new TypeError("Invalid source configuration path");
  return loadSiteLayout(
    JSON.parse(await readFile(resolve(configPath), "utf8")),
  );
}

// Seed revisions use their raw-layout hash as ID; staged revisions are not
// source anchors. Older databases have no sourceBundle and are legacy only.
export async function assertSourceDatabase(
  db,
  selected,
  { requireLayoutMatch = true } = {},
) {
  const rows = (
    await db.query("SELECT id, source_hash, provenance FROM geometry_revisions")
  ).rows;
  const legacy = createSiteSource().layoutFile;
  const anchors = rows.filter((row) => row.id === row.source_hash);
  const alternate = selected.source.layoutFile !== legacy;
  if (
    rows.some(
      (row) =>
        (row.provenance?.sourceBundle &&
          row.provenance.sourceBundle !== selected.source.layoutFile) ||
        (alternate && !row.provenance?.sourceBundle),
    ) ||
    anchors.some(
      (row) =>
        (row.provenance?.sourceBundle || legacy) !== selected.source.layoutFile,
    )
  )
    throw new Error(
      "Database contains a different source bundle or unmarked revisions; use a separate database",
    );
  if (alternate && requireLayoutMatch && !anchors.length)
    throw new Error("Seed the alternate source database before startup");
  if (
    alternate &&
    requireLayoutMatch &&
    !anchors.some((row) => row.id === selected.revision)
  )
    throw new Error("Selected layout does not match a seeded layout revision");
}
