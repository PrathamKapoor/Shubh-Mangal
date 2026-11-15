import { test, expect } from "@playwright/test";
test("original site retains its labelled offline source drawing", async ({ page }) => {
  await page.route("**/api/**", route => route.abort());
  await page.goto("/explore");
  await expect(page.getByRole("link", { name: "Shubh Mangal Residency home" })).toBeVisible();
  await expect(page.getByText("Live inventory is not connected. Showing the reference plan.")).toBeVisible();
  await expect(page.locator("svg .cell").first()).toBeVisible();
});
