import { test, expect } from "@playwright/test";

test("map amenity selection replaces plot details and supports history", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore?plot=plot-1-b49-cell-49");
  // Use the actual source record rather than assuming a label is approved.
  await page.goto("/explore");
  await page.getByPlaceholder("Try a plot number, e.g. B26").fill("B49");
  await page
    .getByRole("button", { name: /Plan label B49 Plan area PLOT/ })
    .click();
  await expect(page.getByLabel("Selected plot details")).toBeVisible();
  await page.getByRole("button", { name: "Reset view" }).click();
  const marker = page.locator('[data-amenity="owner-ref-fountain"]');
  const point = await marker.evaluate((element) => {
    const p = new DOMPoint(167.26, 143.32).matrixTransform(
      element.ownerSVGElement.getScreenCTM(),
    );
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page).toHaveURL(/amenity=owner-ref-fountain/);
  await expect(page.getByLabel("Selected plot details")).toHaveCount(0);
  const card = page.locator(".map-amenity-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Fountain");
  const rect = await card.boundingBox();
  const viewport = page.viewportSize();
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  await page.goBack();
  await expect(page.getByLabel("Selected plot details")).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.goForward();
  await expect(card).toContainText("Fountain");
  await page.getByRole("button", { name: "Close amenity details" }).click();
  await expect(card).toHaveCount(0);
});

test("amenity details are a visible closable mobile sheet and replace plot selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await expect(page.getByLabel("Selected plot details")).toBeVisible();
  await page.getByRole("button", { name: "Close plot details" }).click();
  await page.getByText("Explore amenities", { exact: false }).click();
  await page.getByRole("button", { name: "Temple", exact: true }).click();
  const card = page.locator(".map-amenity-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Temple");
  await expect(page.getByLabel("Selected plot details")).toHaveCount(0);
  const rect = await card.boundingBox();
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.y + rect.height).toBeLessThanOrEqual(844);
  await page.getByRole("button", { name: "Close amenity details" }).click();
  await expect(card).toHaveCount(0);
});

test("proposed pool and gym appear under the clubhouse with honest details", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore");
  await page.getByText("Explore amenities", { exact: false }).click();
  const group = page.getByRole("group", { name: "Clubhouse facilities" });
  for (const [title, id] of [
    ["Swimming pool", "owner-ref-pool"],
    ["Gym", "owner-ref-gym"],
  ]) {
    await group.getByRole("button", { name: title, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`amenity=${id}`));
    await expect(page.locator(".map-amenity-card")).toContainText(title);
    await expect(page.locator(".map-amenity-card")).toContainText("Proposed");
  }
});

test("pool and gym map clicks replace a prior plot selection", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [kind, title, id] of [
    ["pool", "Swimming pool", "owner-ref-pool"],
    ["gym", "Gym", "owner-ref-gym"],
  ]) {
    await page.goto("/explore?plot=plot-1-b26-cell-26");
    await expect(page.getByLabel("Selected plot details")).toBeVisible();
    await page.getByRole("button", { name: "Reset view" }).click();
    const marker = page.locator(`[data-leisure-facility="${kind}"]`);
    await expect(marker).toHaveCount(1);
    const point = await marker.evaluate((element) => {
      const box = element.getBBox();
      const p = new DOMPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      ).matrixTransform(element.getScreenCTM());
      return { x: p.x, y: p.y };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page).toHaveURL(new RegExp(`amenity=${id}`));
    await expect(page.getByLabel("Selected plot details")).toHaveCount(0);
    await expect(page.locator(".map-amenity-card")).toContainText(title);
    await expect(page.locator(".map-amenity-card")).toContainText("Proposed");
    await expect(marker).toHaveClass(/active/);
  }
});

test("mobile facility selection leaves a useful portion of the map visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore?amenity=owner-ref-gym");
  const card = page.locator(".map-amenity-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Gym");
  await page.waitForTimeout(300);
  const map = await page.locator(".map-area").boundingBox();
  const details = await card.boundingBox();
  const visibleMapHeight = Math.max(
    0,
    Math.min(map.y + map.height, details.y, 844) - Math.max(map.y, 0),
  );
  expect(visibleMapHeight).toBeGreaterThanOrEqual(180);
  await expect(
    page.getByRole("button", { name: "Close amenity details" }),
  ).toBeVisible();
});
