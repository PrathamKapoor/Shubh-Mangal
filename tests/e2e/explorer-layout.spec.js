import { test, expect } from "@playwright/test";

test("the map expands until a plot is selected and returns after closing details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/explore");
  const map = page.locator(".map-wrap");
  await expect(map).toBeVisible();
  await expect(page.locator(".workspace > .details")).toHaveCount(0);
  const fullWidth = (await map.boundingBox()).width;
  await page.getByPlaceholder("Try a plot number, e.g. B26").fill("B26");
  await page
    .getByRole("button", { name: /Plan label B26 Plan area PLOT/ })
    .click();
  await expect(page.getByLabel("Selected plot details")).toBeVisible();
  expect((await map.boundingBox()).width).toBeLessThan(fullWidth);
  await page.getByRole("button", { name: "Close plot details" }).click();
  await expect(page.locator(".workspace > .details")).toHaveCount(0);
  await expect
    .poll(async () => (await map.boundingBox()).width)
    .toBe(fullWidth);
});

test("mobile map and plot details remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore");
  await expect(page.locator(".map-wrap")).toBeVisible();
  await page.getByRole("button", { name: /Plot list/ }).click();
  await page.getByPlaceholder("Try a plot number, e.g. B26").fill("B26");
  await page
    .getByRole("button", { name: /Plan label B26 Plan area PLOT/ })
    .click();
  await expect(page.getByLabel("Selected plot details")).toBeVisible();
  await page.getByRole("button", { name: "Close plot details" }).click();
  await expect(page.locator(".map-wrap")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
