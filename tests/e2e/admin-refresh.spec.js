import { test, expect } from "@playwright/test";

test("inventory remains available when the overview request fails", async ({
  page,
}) => {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-test-only-927156!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Data review", exact: true }).click();
  await expect(page.getByLabel("Find a draft cell")).toBeVisible();
  await page.route("**/api/admin/overview", (route) => route.abort("timedout"));
  await page.route("**/api/admin/plots", (route) =>
    route.fulfill({
      json: {
        plots: [
          {
            id: "synthetic-record",
            number: "TEST-24",
            block: "TEST-B",
            publication: "draft",
            status: "unverified",
          },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByLabel("Choose a record").locator("option"),
  ).toContainText(["Select…", "TEST-B / TEST-24 · draft · unverified"]);
  await expect(page.getByRole("alert")).toContainText("Overview unavailable");
});

test("inventory loads while overview is pending and primary errors stay visible", async ({
  page,
}) => {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-test-only-927156!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Data review", exact: true }).click();
  await expect(page.getByLabel("Find a draft cell")).toBeVisible();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/overview", async (route) => {
    await pending;
    await route.fulfill({ json: { counts: {} } }).catch(() => {});
  });
  await page.route("**/api/admin/plots", (route) =>
    route.fulfill({
      json: {
        plots: [
          {
            id: "synthetic-record",
            number: "TEST-24",
            block: "TEST-B",
            publication: "draft",
            status: "unverified",
          },
        ],
      },
    }),
  );
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByLabel("Choose a record").locator("option"),
  ).toContainText(["Select…", "TEST-B / TEST-24 · draft · unverified"]);
  await page.unroute("**/api/admin/plots");
  await page.route("**/api/admin/plots", (route) =>
    route.fulfill({ status: 503, json: { error: "Inventory unavailable" } }),
  );
  await page.getByRole("button", { name: "Data review", exact: true }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Inventory unavailable");
  release();
});
