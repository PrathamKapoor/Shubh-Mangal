import { test, expect } from "@playwright/test";

const square = (x, y, size) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
];
const features = [
  {
    type: "Feature",
    id: "polygon",
    geometry: {
      type: "Polygon",
      coordinates: [
        square(74.908, 24.466, 0.0002),
        square(74.90807, 24.46607, 0.00006),
      ],
    },
  },
  {
    type: "Feature",
    id: "multi",
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [square(74.9084, 24.466, 0.0002), square(74.90847, 24.46607, 0.00006)],
        [square(74.9087, 24.466, 0.0002)],
      ],
    },
  },
];
const collection = {
  type: "FeatureCollection",
  features,
  mappings: features.map((f) => ({ plot_id: f.id })),
  snapshot: "synthetic",
};

test("published parcel context supports geometry, refresh failures and local drafts", async ({
  page,
}) => {
  let response = "loading";
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/public/geometry", async (route) => {
    const current = response;
    if (current === "loading") await pending;
    if (current === "error")
      return route.fulfill({ status: 503, json: { error: "offline" } });
    if (current === "empty")
      return route.fulfill({
        json: { type: "FeatureCollection", features: [], mappings: [] },
      });
    if (current === "incomplete")
      return route.fulfill({
        json: { ...collection, features: [features[0]] },
      });
    return route.fulfill({ json: collection });
  });
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-test-only-927156!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Data review", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Content", exact: true }).click();
  const editor = page
    .locator("details.admin-card")
    .filter({ hasText: "Add content" });
  await editor.locator(":scope > summary").click();
  await editor
    .getByRole("combobox", { name: "Kind", exact: true })
    .selectOption("site_access");
  const review = editor.getByRole("region", { name: "Footprint review" });
  await expect(
    review.getByText("Loading published mapped parcels…"),
  ).toBeVisible();
  await editor
    .getByLabel("Name (English)", { exact: true })
    .fill("Unsaved access");
  await review.getByLabel("Import footprint JSON").fill(
    JSON.stringify({
      datum: "WGS84",
      source: "Synthetic evidence",
      sourceRevision: "one",
      outer: square(74.908, 24.466, 0.0002),
      holes: [],
      interactions: [],
    }),
  );
  await review.getByRole("button", { name: "Import footprint" }).click();
  await review
    .getByLabel("Footprint evidence source")
    .fill("Unsaved footprint evidence");
  await review
    .getByLabel("Outer boundary vertex 1 (longitude, latitude)")
    .fill("74.90801, 24.46601");
  release();
  await expect(
    review.getByText("Published mapped parcels: 2", { exact: false }),
  ).toBeVisible();
  const toggle = review.getByLabel("Show published mapped parcels");
  const paths = review.locator("[data-published-parcel]");
  await expect(paths).toHaveCount(3);
  const fill = async (locator, outerWeight) =>
    locator.evaluate((path, weight) => {
      const commands = [
        ...path.getAttribute("d").matchAll(/[ML]\s*([-\d.eE]+)\s+([-\d.eE]+)/g),
      ].map((m) => [Number(m[1]), Number(m[2])]);
      const point = new DOMPoint(
        commands[0][0] * (1 - weight) + commands[2][0] * weight,
        commands[0][1] * (1 - weight) + commands[2][1] * weight,
      );
      return path.isPointInFill(point);
    }, outerWeight);
  await expect(paths.nth(0)).toHaveAttribute("fill-rule", "evenodd");
  expect(await fill(paths.nth(0), 0.2)).toBe(true);
  expect(await fill(paths.nth(0), 0.5)).toBe(false);
  expect(await fill(paths.nth(1), 0.2)).toBe(true);
  expect(await fill(paths.nth(1), 0.5)).toBe(false);
  expect(await fill(paths.nth(2), 0.5)).toBe(true);
  await toggle.uncheck();
  await expect(paths).toHaveCount(0);
  await toggle.check();
  await expect(paths).toHaveCount(3);
  const refresh = review.getByRole("button", {
    name: "Refresh published parcels",
  });
  response = "error";
  await refresh.click();
  await expect(
    review.getByText("Published mapped parcels are unavailable", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(paths).toHaveCount(0);
  response = "incomplete";
  await refresh.click();
  await expect(
    review.getByText("Published mapped parcels are incomplete", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(paths).toHaveCount(0);
  response = "empty";
  await refresh.click();
  await expect(
    review.getByText("No published mapped parcels", { exact: false }),
  ).toBeVisible();
  response = "success";
  await refresh.click();
  await expect(paths).toHaveCount(3);
  await expect(
    editor.getByLabel("Name (English)", { exact: true }),
  ).toHaveValue("Unsaved access");
  await expect(review.getByLabel("Footprint evidence source")).toHaveValue(
    "Unsaved footprint evidence",
  );
  await expect(
    review.getByLabel("Outer boundary vertex 1 (longitude, latitude)"),
  ).toHaveValue("74.90801, 24.46601");
});
