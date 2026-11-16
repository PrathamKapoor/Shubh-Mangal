import { mkdir, copyFile } from "node:fs/promises";
import { loadSiteSource } from "../server/site-source.mjs";
await mkdir("public/downloads", { recursive: true });
const selected = await loadSiteSource(process.env.SITE_SOURCE_CONFIG);
const legacySources = selected.source.layoutFile === "public/data/layout.json" ? [
  ["source-data/MAHENDRAR JI ALL PDF NORTH.pdf", "survey-plan-north.pdf"],
  ["source-data/Shubh_Mangal_Full_Layout.kml", "Shubh_Mangal_Full_Layout.kml"],
] : [];
for (const [source, dest] of [
  ...legacySources,
  ["docs/inventory-review-template.csv", "inventory-review-template.csv"],
  ["docs/identity-approval-template.csv", "identity-approval-template.csv"],
  ["docs/inventory-update-template.csv", "inventory-update-template.csv"],
])
  await copyFile(source, `public/downloads/${dest}`);
console.info("Source download copies prepared; originals unchanged.");
