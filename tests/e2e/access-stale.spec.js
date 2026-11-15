import { test, expect } from "@playwright/test";

test("an entrance awaiting revalidation explains why gate directions are unavailable", async ({ page }) => {
  await page.route("**/api/public/project", async (route) => {
    const response = await route.fetch();
    const project = await response.json();
    await route.fulfill({ response, json: { ...project, siteAccessStatus: "needs_review", items: project.items.filter((item) => item.kind !== "site_access") } });
  });
  await page.goto("/explore");
  await expect(page.getByRole("status").filter({ hasText: "entrance footprint needs another review" })).toBeVisible();
  await page.goto("/location");
  await expect(page.getByText("The entrance footprint needs another review against current parcel information. Gate directions are temporarily unavailable.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Google Maps directions" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /View approximate site area/ })).toBeVisible();
});
