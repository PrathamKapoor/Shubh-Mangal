import { test, expect } from "@playwright/test";

test("3D gracefully falls back to the same 2D selection and camera when WebGL is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (
        type === "webgl" ||
        type === "webgl2" ||
        type === "experimental-webgl"
      )
        return null;
      return original.call(this, type, ...args);
    };
  });
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  const svg = page.locator(".map-area > svg");
  await expect(page.getByLabel("Selected plot details")).toBeVisible();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Zoom out" }).click();
  const before = await svg.getAttribute("viewBox");
  await page.getByRole("button", { name: "3D colony" }).click();
  await expect(
    page.getByText("3D is unavailable on this device. Use the 2D map."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to 2D map" }).click();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
  await expect(svg).toHaveAttribute("viewBox", before);
  await expect(page.getByLabel("Selected plot details")).toBeVisible();
});

test("3D lazy-loading failure provides a 2D fallback", async ({ page }) => {
  await page.route("**/src/components/Colony3D.jsx*", (route) => route.abort());
  await page.goto("/explore");
  await page.getByRole("button", { name: "3D colony" }).click();
  await expect(page.getByText("The 3D view could not load.")).toBeVisible();
  await page.getByRole("button", { name: "Back to 2D map" }).click();
  await expect(page.locator(".map-area > svg")).toBeVisible();
});

test("3D provides interactive controls and preserves selection when switching views", async ({
  page,
}) => {
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await expect(page.getByLabel("Selected plot details")).toBeVisible();
  await page.getByRole("button", { name: "3D colony" }).click();
  const scene = page.getByRole("region", { name: "Illustrative 3D colony" });
  await expect(scene).toBeVisible();
  await expect(scene.locator("canvas")).toBeVisible();
  await expect(scene.getByRole("button", { name: "Top view" })).toBeVisible();
  await scene.getByRole("button", { name: "Top view" }).click();
  await scene.getByRole("button", { name: "Back to 2D map" }).click();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
});

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`3D controls remain usable with amenity details open at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/explore?amenity=owner-ref-clubhouse");
    await expect(page.locator(".map-amenity-card")).toContainText("Clubhouse");
    await page.getByRole("button", { name: "3D colony" }).click();
    const scene = page.getByRole("region", { name: "Illustrative 3D colony" });
    await expect(scene).toBeVisible();
    await scene.getByRole("button", { name: "Tilt view" }).click();
    await expect(page.locator(".map-amenity-card")).toContainText("Clubhouse");
    await scene.getByRole("button", { name: "Back to 2D map" }).click();
    await expect(page.locator(".map-area > svg")).toBeVisible();
    await expect(page.locator(".map-amenity-card")).toContainText("Clubhouse");
  });
}
