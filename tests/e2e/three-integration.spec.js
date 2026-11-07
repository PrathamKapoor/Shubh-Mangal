import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const source = JSON.parse(
  await readFile(
    new URL("../../public/data/layout.json", import.meta.url),
    "utf8",
  ),
);
const statuses = ["available", "reserved", "sold", "unverified"];
const syntheticPlots = statuses.map((status, index) => ({
  ...source.plots[index],
  id: `fixture-${status}`,
  geometryId: source.plots[index].id,
  label: `TEST-${status}`,
  block: "TEST",
  status,
  approved: { number: `TEST-${status}`, block: "TEST", dimensions: [] },
  publication: "published",
}));
async function fixtures(page) {
  await page.route("**/api/public/project", (route) =>
    route.fulfill({ json: { mode: "connected", items: [] } }),
  );
  await page.route("**/api/public/plots?**", (route) =>
    route.fulfill({
      json: { plots: syntheticPlots, total: syntheticPlots.length },
    }),
  );
}
async function dominantCenterPixel(page) {
  const image = await page.locator(".colony-three-canvas canvas").screenshot();
  return page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(
      Math.round(canvas.width / 2) - 10,
      Math.round(canvas.height / 2) - 10,
      20,
      20,
    ).data;
    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1])[0][0]
      .split(",")
      .map(Number);
  }, image.toString("base64"));
}
test("3D renders isolated approved status fixtures distinctly and retains selected IDs", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixtures(page);
  const pixels = {};
  for (const status of statuses) {
    await page.goto(`/explore?plot=fixture-${status}`);
    await expect(page.locator(".cell.selected")).toHaveAttribute(
      "data-plot",
      `fixture-${status}`,
    );
    await page.getByRole("button", { name: "3D colony" }).click();
    const scene = page.getByRole("region", { name: "Illustrative 3D colony" });
    await expect(scene.locator("canvas")).toBeVisible();
    await page.getByLabel("Numbers", { exact: true }).uncheck();
    await expect(scene).toHaveAttribute("data-labels-visible", "false");
    pixels[status] = await dominantCenterPixel(page);
    await scene.getByRole("button", { name: "Back to 2D map" }).click();
    await expect(page.locator(".cell.selected")).toHaveAttribute(
      "data-plot",
      `fixture-${status}`,
    );
    await expect(page).toHaveURL(new RegExp(`plot=fixture-${status}`));
  }
  const [greenR, greenG, greenB] = pixels.available;
  const [orangeR, orangeG, orangeB] = pixels.reserved;
  const [soldR, soldG, soldB] = pixels.sold;
  const [unknownR, unknownG, unknownB] = pixels.unverified;
  expect(greenG).toBeGreaterThan(greenR + 10);
  expect(greenG).toBeGreaterThan(greenB + 10);
  expect(orangeR).toBeGreaterThan(orangeG + 10);
  expect(orangeG).toBeGreaterThan(orangeB + 10);
  expect(
    Math.max(soldR, soldG, soldB) - Math.min(soldR, soldG, soldB),
  ).toBeLessThan(12);
  expect(
    Math.max(unknownR, unknownG, unknownB) -
      Math.min(unknownR, unknownG, unknownB),
  ).toBeLessThan(12);
  expect(unknownR).toBeGreaterThan(soldR + 12);
});

test("3D filters, layer controls and focus stay connected to the same list selection", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixtures(page);
  await page.goto("/explore?plot=fixture-available");
  await page.getByText("Filter plots", { exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("reserved");
  await page.getByRole("button", { name: "3D colony" }).click();
  const scene = page.getByRole("region", { name: "Illustrative 3D colony" });
  await expect(scene).toHaveAttribute("data-visible-plot-count", "1");
  await expect(
    scene.getByRole("button", { name: "Focus selected" }),
  ).toBeEnabled();
  await scene.getByRole("button", { name: "Focus selected" }).click();
  await page.getByLabel("Numbers", { exact: true }).uncheck();
  await expect(scene).toHaveAttribute("data-labels-visible", "false");
  await page.getByLabel("Numbers", { exact: true }).check();
  await expect(scene).toHaveAttribute("data-labels-visible", "true");
  await scene.getByRole("button", { name: "Back to 2D map" }).click();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "fixture-available",
  );
});

test("dragging over a different 3D plot rotates without changing the selected record", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixtures(page);
  await page.goto("/explore?plot=fixture-available");
  await page.getByRole("button", { name: "3D colony" }).click();
  await page.getByLabel("Numbers", { exact: true }).uncheck();
  const canvas = page.locator(".colony-three-canvas canvas");
  // Wait for the camera to finish its initial focus on the selected fixture.
  await expect
    .poll(async () => {
      const [r, g, b] = await dominantCenterPixel(page);
      return g > r + 10 && g > b + 10;
    })
    .toBe(true);
  const box = await canvas.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2 - 48;
  // The fixture's second adjacent plot sits directly above the focused first
  // one. A stationary click proves the point picks that distinct record.
  await page.mouse.click(x, y);
  await expect(page).toHaveURL(/\/plots\/fixture-reserved/);
  await page.goto("/explore?plot=fixture-available");
  await page.getByRole("button", { name: "3D colony" }).click();
  await page.getByLabel("Numbers", { exact: true }).uncheck();
  await expect
    .poll(async () => {
      const [r, g, b] = await dominantCenterPixel(page);
      return g > r + 10 && g > b + 10;
    })
    .toBe(true);
  const again = await canvas.boundingBox();
  const sx = again.x + again.width / 2,
    sy = again.y + again.height / 2 - 48;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 40, sy + 25, { steps: 8 });
  await page.mouse.up();
  await expect(page).toHaveURL(/plot=fixture-available/);
  await expect(page.getByLabel("Selected plot details")).toContainText(
    "TEST-available",
  );
});

test("mobile 3D leaves page scrolling available and keeps details outside the canvas", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await page.goto(
      "http://127.0.0.1:5181/explore?amenity=owner-ref-clubhouse",
    );
    await page.getByRole("button", { name: "3D colony" }).click();
    const scene = page.getByRole("region", { name: "Illustrative 3D colony" });
    const canvas = scene.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect(
      scene.getByRole("button", { name: "Enable touch controls" }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(canvas).toHaveCSS("touch-action", "pan-y");
    await scene.getByRole("button", { name: "Enable touch controls" }).click();
    await expect(
      scene.getByRole("button", { name: "Scroll page" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveCSS("touch-action", "none");
    await scene.getByRole("button", { name: "Scroll page" }).click();
    await expect(canvas).toHaveCSS("touch-action", "pan-y");
    const bounds = await canvas.boundingBox();
    expect(bounds.height).toBeGreaterThan(200);
    const card = page.locator(".map-amenity-card");
    await expect(card).toContainText("Clubhouse");
    const cardBounds = await card.boundingBox();
    expect(cardBounds.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    await expect(
      card.getByRole("button", { name: "Close amenity details" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("3D amenity visibility toggle is independent of selection and reversible", async ({
  page,
}) => {
  await page.goto("/explore?amenity=owner-ref-fountain");
  await page.getByRole("button", { name: "3D colony" }).click();
  const scene = page.getByRole("region", { name: "Illustrative 3D colony" });
  const amenities = page.getByLabel("Amenities", { exact: true });
  await expect(scene).toHaveAttribute("data-amenities-visible", "true");
  await amenities.uncheck();
  await expect(scene).toHaveAttribute("data-amenities-visible", "false");
  await expect(page.locator(".map-amenity-card")).toContainText("Fountain");
  await amenities.check();
  await expect(scene).toHaveAttribute("data-amenities-visible", "true");
  await expect(page).toHaveURL(/amenity=owner-ref-fountain/);
});
