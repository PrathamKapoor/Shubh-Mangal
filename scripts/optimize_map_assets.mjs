// Build compact web copies without modifying or overwriting any supplied PNG.
// Requires Playwright Chromium or PLAYWRIGHT_CHROMIUM_EXECUTABLE.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const assets = [
  ...["garden-temple", "fountain-corner", "fountain-center"].map((name) => ({
    input: `${name}.png`,
    output: `public/assets/concepts/${name}-map.webp`,
    size: 768,
  })),
  ...[
    "houseclub-no-pool",
    "entry-gate-road-free",
    "temple-foreground",
    "playground-foreground",
    "clubhouse-foreground",
  ].map((name) => ({
    input: `public/assets/concepts/${name}.png`,
    output: `public/assets/concepts/${name}-map.webp`,
    size: 768,
  })),
  ...["plot-grass", "road-texture"].map((name) => ({
    input: `${name}.png`,
    output: `public/assets/textures/${name}.webp`,
    size: 512,
  })),
];
await mkdir("public/assets/textures", { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
try {
  const page = await browser.newPage();
  const requested = new Set(process.argv.slice(2));
  const selected = requested.size
    ? assets.filter(({ output }) =>
        [...requested].some(
          (name) =>
            output.endsWith(`/${name}-map.webp`) ||
            output.endsWith(`/${name}.webp`),
        ),
      )
    : assets;
  if (requested.size && selected.length !== requested.size)
    throw Error("Unknown or duplicate map asset name");
  for (const { input, output, size } of selected) {
    const source = await readFile(input);
    const data = await page.evaluate(
      async ({ base64, size }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const ratio = Math.min(1, size / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * ratio);
        canvas.height = Math.round(image.height * ratio);
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/webp", 0.86).split(",")[1];
      },
      { base64: source.toString("base64"), size },
    );
    const result = Buffer.from(data, "base64");
    await writeFile(output, result, { flag: "wx" });
    console.log(
      `${input}: ${source.length} → ${output}: ${result.length} bytes`,
    );
  }
} finally {
  await browser.close();
}
