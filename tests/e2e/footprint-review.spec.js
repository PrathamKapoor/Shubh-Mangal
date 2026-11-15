import { test, expect } from "@playwright/test";
import { geographicToPlan, planToGeographic } from "../../shared/geography.mjs";
import layout from "../../public/data/layout.json" with {type:"json"};

test("owner saves, stages, reloads and publishes a synthetic entrance footprint", async ({
  page,
}, testInfo) => {
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
  const newContent = page
    .locator("details.admin-card")
    .filter({ hasText: "Add content" });
  await newContent.locator(":scope > summary").click();
  await newContent
    .getByRole("combobox", { name: "Kind", exact: true })
    .selectOption("site_access");
  await newContent
    .getByLabel("Name (English)", { exact: true })
    .fill("Synthetic entrance");
  await newContent
    .getByLabel("Route access latitude (confirm before publishing)")
    .fill("24.466");
  await newContent.getByLabel("Route access longitude").fill("74.908");
  await newContent
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("existing");
  await newContent
    .getByLabel("Source", { exact: true })
    .fill("Synthetic source");
  await newContent
    .getByLabel("Source revision / date (required)")
    .fill("test-1");
  await newContent
    .getByLabel("Last reviewed (ISO date/time)")
    .fill("2026-01-01T00:00:00Z");
  await newContent.getByLabel("Visible to customers after publication").check();
  await newContent
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic access fixture");
  await newContent.getByRole("button", { name: "Save content" }).click();
  await expect(
    page
      .locator("details.admin-card > summary")
      .filter({ hasText: "visitor-entrance" }),
  ).toBeVisible();
  const editor = page
    .locator("details.admin-card")
    .filter({ hasText: "visitor-entrance" });
  await editor.locator(":scope > summary").click();
  await editor
    .getByLabel("Name (English)", { exact: true })
    .fill("Unsaved access edit");
  const anchor = geographicToPlan({lon:74.908,lat:24.466},layout);
  const ring = [[0,0],[8,0],[8,-2],[0,-2],[0,0]].map(([dx,dy],i)=> {
    if (i===0 || i===4) return [74.908,24.466];
    const p=planToGeographic({x:anchor.x+dx,y:anchor.y+dy},layout); return [p.lon,p.lat];
  });
  const footprint = { datum:"WGS84", source:"Synthetic survey fixture", sourceRevision:"test-1", outer:ring, holes:[], interactions:[] };
  await editor
    .getByLabel("Import footprint JSON")
    .fill(JSON.stringify(footprint));
  await editor.getByRole("button", { name: "Import footprint" }).click();
  await expect(editor.getByLabel("Footprint preview")).toBeVisible();
  await editor
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic footprint staging");
  await editor.getByRole("button", { name: "Stage footprint" }).click();
  await expect(
    editor.getByText("Server assessment", { exact: false }),
  ).toBeVisible();
  await expect(
    editor.getByLabel("Name (English)", { exact: true }),
  ).toHaveValue("Unsaved access edit");
  const items = await (await page.request.get("/api/admin/content")).json();
  const item = items.items.find((entry) => entry.id === "visitor-entrance");
  expect(item.draft.footprint).toEqual(footprint);
  expect(item.draft.title).toBe("Synthetic entrance");
  expect(item.published).toBeNull();

  await page.reload();
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await editor.locator(":scope > summary").click();
  await expect(
    editor.getByLabel("Name (English)", { exact: true }),
  ).toHaveValue("Synthetic entrance");
  await expect(editor.getByLabel("Footprint evidence source")).toHaveValue(
    footprint.source,
  );
  await expect(
    editor.getByLabel("Outer boundary vertex 1 (longitude, latitude)"),
  ).toHaveValue("74.908, 24.466");
  await editor.getByLabel("Physical anchor latitude (confirm before publishing)").fill("24.466");
  await editor.getByLabel("Physical anchor longitude").fill("74.908");
  await editor.getByLabel("Heading (degrees clockwise from north, optional)").fill("0");
  await editor.getByRole("combobox", {name:"Gate model",exact:true}).selectOption("synthetic-gate");
  await editor.getByLabel("Gate model rights and source").fill("Synthetic procedural fixture");
  await editor.getByLabel("Gate model correspondence evidence").fill("Synthetic gate outline");
  await editor.getByLabel("Gate width (m)").fill("8");
  await editor.getByLabel("Gate depth (m)").fill("2");
  await editor.getByLabel("Left gatepost width (m)").fill("1");
  await editor.getByLabel("Right gatepost width (m)").fill("2");
  await editor.getByLabel("Gate dimensions source", {exact:true}).fill("Synthetic dimensions");
  await editor.getByLabel("Gate dimensions source revision").fill("dimensions-1");
  await editor.getByLabel("Gate measured height (m, optional)").fill("3");
  await editor.getByLabel("Gate height source", {exact:true}).fill("Synthetic height");
  await editor.getByLabel("Gate height source revision").fill("height-1");
  await editor.getByLabel("Reason", {exact:true}).fill("Synthetic gate model staging");
  await editor.getByRole("button", {name:"Save content"}).click();
  await page.reload();
  await page.getByRole("button", {name:"Content",exact:true}).click();
  await editor.locator(":scope > summary").click();
  await expect(editor.getByLabel("Gate width (m)")).toHaveValue("8");
  await editor
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic publication review");
  await editor.getByLabel("Publish after evidence verification").check();
  await editor.getByRole("button", { name: "Save content" }).click();
  await expect(
    page
      .locator("details.admin-card > summary")
      .filter({ hasText: "visitor-entrance · Published" }),
  ).toBeVisible();
  const publishedItems = await (
    await page.request.get("/api/admin/content")
  ).json();
  const published = publishedItems.items.find(
    (entry) => entry.id === "visitor-entrance",
  );
  expect(published.published).toEqual(published.draft);
  expect(published.published.footprint).toEqual(footprint);
  expect(published.published.title).toBe("Synthetic entrance");
  const project = await (await page.request.get("/api/public/project")).json();
  const publicAccess = project.items.find(
    (entry) => entry.id === "visitor-entrance",
  );
  expect(publicAccess.published.footprint).toMatchObject({
    outer: footprint.outer,
    holes: footprint.holes,
  });
  await page.goto("/explore");
  await page.getByRole("button", { name: "2D plan (Source drawing)" }).click();
  await expect(page.locator('[data-feature-id="visitor-entrance"]')).toBeVisible();
  const accessButton = page.getByRole("button", { name: "Reviewed visitor entrance" });
  await accessButton.click();
  await expect(page.getByText(/Synthetic entrance · Published physical footprint/)).toBeVisible();
  await page.getByRole("button", { name: "3D colony" }).click();
  await expect(accessButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Synthetic gate model is illustrative.", {exact:false})).toBeVisible();
  await expect(page.getByRole("button", {name:"Focus selected"})).toBeEnabled();
  await page.getByRole("button", {name:"Focus selected"}).click();
  await page.getByRole("button", {name:"Tilt view"}).click();
  await page.locator(".colony-three-view canvas").screenshot({path:testInfo.outputPath("synthetic-gate.png")});
});
