// One-time web copies of the owner-supplied PNGs. The originals are never changed.
// Run with a Playwright Chromium installation (or PLAYWRIGHT_CHROMIUM_EXECUTABLE).
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const assets = ["fountain", "temple", "garden", "club-house", "entry-gate"];
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  const page = await browser.newPage();
  for (const name of assets) {
    const source = await readFile(new URL(`../${name}.png`, import.meta.url));
    const data = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const ratio = Math.min(1, 640 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/webp", 0.9).split(",")[1];
    }, source.toString("base64"));
    const result = Buffer.from(data, "base64");
    const destination = new URL(
      `../public/assets/concepts/${name}-map.webp`,
      import.meta.url,
    );
    await writeFile(destination, result, { flag: "wx" });
    console.log(`${name}: ${source.length} → ${result.length} bytes`);
  }
} finally {
  await browser.close();
}
