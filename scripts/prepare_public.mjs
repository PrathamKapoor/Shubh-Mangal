import { mkdir, copyFile } from "node:fs/promises";
await mkdir("public/downloads", { recursive: true });
for (const [source, dest] of [
  ["source-data/MAHENDRAR JI ALL PDF NORTH.pdf", "survey-plan-north.pdf"],
  ["source-data/Shubh_Mangal_Full_Layout.kml", "Shubh_Mangal_Full_Layout.kml"],
  ["docs/inventory-review-template.csv", "inventory-review-template.csv"],
  ["docs/identity-approval-template.csv", "identity-approval-template.csv"],
  ["docs/inventory-update-template.csv", "inventory-update-template.csv"],
])
  await copyFile(source, `public/downloads/${dest}`);
console.info("Source download copies prepared; originals unchanged.");
