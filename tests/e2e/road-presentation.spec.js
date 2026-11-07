import { test, expect } from "@playwright/test";

test("illustrated street detailing is non-interactive and the source drawing is unchanged", async ({
  page,
}) => {
  await page.goto("/explore");
  const roadDetails = page.locator("[data-illustrative-road-details]");
  await expect(roadDetails).toBeAttached();
  await expect(roadDetails).toHaveCSS("pointer-events", "none");
  const plot = page.locator('[data-plot="plot-1-b26-cell-26"]');
  await expect(plot).toBeAttached();
  await plot.click();
  await expect(
    page.getByRole("heading", { name: "Plan label B26", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Source drawing" }).click();
  await expect(roadDetails).toHaveCount(0);
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
});
