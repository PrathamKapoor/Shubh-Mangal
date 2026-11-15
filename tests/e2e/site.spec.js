import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  ownerAmenityReferences,
  previewAmenity,
} from "../../shared/owner-amenity-references.mjs";
async function pick(page, label) {
  const search = page.getByPlaceholder("Try a plot number, e.g. B26");
  await search.fill(label);
  await page
    .getByRole("button", {
      name: new RegExp(`Plan label ${label} Plan area PLOT`),
    })
    .click();
  await expect(
    page.getByRole("heading", { name: `Plan label ${label}`, exact: true }),
  ).toBeVisible();
}
test("homepage navigation and source documents are honest and accessible", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your space",
  );
  await expect(page.locator(".hero-plan img")).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole("link", { name: "Original plans", exact: true }).click();
  await expect(
    page.getByText("Unverified historical marketing source.", { exact: false }),
  ).toBeVisible();
  const pdf = await page.request.get("/downloads/survey-plan-north.pdf");
  expect(pdf.headers()["content-type"]).toContain("pdf");
});
test("search, selection, dimensions, shortlist, comparison and history use one record", async ({
  page,
}) => {
  await page.goto("/explore");
  await pick(page, "B26");
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
  await expect(page.locator(".area-value")).toContainText("Approx.");
  await page.getByRole("button", { name: "Metres", exact: true }).click();
  await expect(page.locator(".edge-list")).toContainText("Approx. 9.8 m");
  await page.getByRole("button", { name: "♡ Shortlist", exact: true }).click();
  await page.getByRole("button", { name: "＋ Compare", exact: true }).click();
  await pick(page, "B25");
  await page.getByRole("button", { name: "＋ Compare", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Plan label B26", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Plan label B25", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Compare (2/3)" }).click();
  await expect(page.getByRole("table")).toContainText("Not provided");
  await expect(page.getByRole("table")).toContainText("Approx.");
  await page.reload();
  await expect(page.getByRole("table")).toContainText("Plan label B26");
  await expect(page.getByRole("table")).toContainText("Plan label B25");
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await expect(
    page.getByRole("button", { name: "♥ Shortlisted" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Plan label B26", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "♥ Shortlisted" }),
  ).toBeVisible();
});
test("comparison identifies selections missing from current published data", async ({
  page,
}) => {
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "sm-compare",
      JSON.stringify(["plot-1-b26-cell-26"]),
    ),
  );
  await page.route("**/api/public/project", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "connected", items: [] }),
    }),
  );
  await page.route("**/api/public/plots?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plots: [], total: 0 }),
    }),
  );
  await page.goto("/compare");
  await expect(
    page.getByText("Some selections are not in the current data.", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove unavailable selections" })
    .click();
  await expect(
    page.getByText("Choose “Compare” in plot details", { exact: false }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(sessionStorage.getItem("sm-compare"))),
    )
    .toEqual([]);
});

test("the original document is separate and keeps the selected plot across map views", async ({
  page,
}) => {
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  const cell = page.locator(".cell.selected");
  await expect(cell).toHaveAttribute("data-plot", "plot-1-b26-cell-26");
  await expect(
    page.getByText("Illustrative layout · not to scale"),
  ).toBeVisible();
  await expect(page.locator(".scale")).toHaveCount(0);
  await page.getByRole("button", { name: "Original plan" }).click();
  await expect(page.locator(".original-plan-view img")).toBeVisible();
  await page
    .locator(".original-plan-view img")
    .evaluate((image) => image.decode());
  await expect(
    page.getByRole("link", { name: "Open original PDF" }),
  ).toHaveAttribute("href", "/downloads/survey-plan-north.pdf");
  await expect(cell).toHaveAttribute("data-plot", "plot-1-b26-cell-26");
  await page.getByRole("button", { name: "Source drawing" }).click();
  await expect(page.locator(".scale")).toHaveCount(1);
  await expect(cell).toHaveAttribute("data-plot", "plot-1-b26-cell-26");
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  await expect(cell).toHaveAttribute("data-plot", "plot-1-b26-cell-26");
  await expect(page).toHaveURL(/plot=plot-1-b26-cell-26/);
  await page.getByRole("button", { name: "Fullscreen map" }).click();
  await page.getByRole("button", { name: "Original plan" }).click();
  await page.getByRole("button", { name: "Exit fullscreen map" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the original plan offers its PDF when the preview image fails", async ({
  page,
}) => {
  await page.route("**/assets/survey-plan-north.png", (route) => route.abort());
  await page.goto("/explore");
  await page.getByRole("button", { name: "Original plan" }).click();
  await expect(page.getByRole("alert")).toContainText("could not load");
  await expect(
    page.getByRole("link", { name: "Open original PDF" }),
  ).toBeVisible();
});
test("block and area filters, empty state and keyboard selection", async ({
  page,
}) => {
  await page.goto("/explore");
  await page.getByText("Filter plots", { exact: true }).click();
  await page
    .getByLabel("Plan area (reference)", { exact: true })
    .selectOption("PLOT 1");
  await expect(page.locator(".plot-row")).toHaveCount(52);
  await page.getByLabel("Min area (m²)").fill("100000");
  await expect(
    page.getByText("No matching plots.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page.getByPlaceholder("Try a plot number, e.g. B26").fill("B26");
  const result = page.getByRole("button", {
    name: /Plan label B26 Plan area PLOT/,
  });
  await result.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Plan label B26", exact: true }),
  ).toBeVisible();
  const svg = page.locator(".map-area > svg");
  await svg.focus();
  const before = await svg.getAttribute("viewBox");
  await page.keyboard.press("+");
  expect(await svg.getAttribute("viewBox")).not.toBe(before);
  await page
    .getByRole("button", { name: "Fullscreen map", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Close plot details" }).click();
  await expect(svg).toBeFocused();
});
test("unknown direct links never substitute another plot", async ({ page }) => {
  await page.goto("/plots/00000000-0000-4000-a000-000000000000");
  await expect(
    page.getByRole("heading", { name: "Plot not found" }),
  ).toBeVisible();
  await expect(page.locator(".cell.selected")).toHaveCount(0);
  await page.goto("/explore?block=NOT-PUBLISHED");
  await expect(
    page.getByText("This approved block is no longer published."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to full colony" }).click();
  await expect(page).toHaveURL(/\/explore$/);
});
test("enquiry validation, API failure retention and durable success", async ({
  page,
}) => {
  await page.goto("/contact?plot=plot-1-b26-cell-26");
  await expect(page.getByLabel("Selected plot (optional)")).toHaveValue(
    "plot-1-b26-cell-26",
  );
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  await expect(page.locator("#contact-name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Your name *").fill("E2E Synthetic Buyer");
  await page.getByLabel("Phone number *").fill("+91 9000000000");
  await page
    .getByLabel("I consent to being contacted", { exact: false })
    .check();
  await page.route("**/api/enquiries", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Test outage" }),
    }),
  );
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  await expect(page.getByRole("alert")).toContainText("Test outage");
  await expect(page.getByLabel("Your name *")).toHaveValue(
    "E2E Synthetic Buyer",
  );
  await page.unroute("**/api/enquiries");
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/enquiries") && r.method() === "POST",
  );
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  expect((await request).postDataJSON().plotIds).toEqual([
    "plot-1-b26-cell-26",
  ]);
  await expect(
    page.getByRole("status").filter({ hasText: "Reference:" }),
  ).toContainText("Saved to the local development database");
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-test-only-927156!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Enquiries", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Synthetic Buyer · new" }),
  ).toBeVisible();
  const lead = page
    .locator("article.admin-card")
    .filter({ hasText: "E2E Synthetic Buyer" });
  await expect(lead).toContainText("B26 (unverified when submitted)");
  await lead.getByLabel("Assigned staff").selectOption({ label: "Test Owner" });
  await lead
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic follow-up assignment");
  await lead.getByRole("button", { name: "Save follow-up" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Lead updated" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Enquiries", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "E2E Synthetic Buyer · new" }),
  ).toBeVisible();
});
test("visit form saves requested status, never confirms automatically", async ({
  page,
}) => {
  await page.goto("/contact?type=visit&plot=plot-1-b26-cell-26");
  await expect(page.getByLabel("Selected plot (optional)")).toHaveValue(
    "plot-1-b26-cell-26",
  );
  await page.getByLabel("Your name *").fill("E2E Visit Buyer");
  await page.getByLabel("Phone number *").fill("+91 9000000001");
  await page
    .getByLabel("Preferred date *")
    .fill(new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10));
  await page
    .getByLabel("I consent to being contacted", { exact: false })
    .check();
  const request = page.waitForRequest(
    (r) => r.url().endsWith("/api/visit-requests") && r.method() === "POST",
  );
  await page
    .getByRole("button", { name: "Request a visit", exact: false })
    .click();
  expect((await request).postDataJSON().plotIds).toEqual([
    "plot-1-b26-cell-26",
  ]);
  await expect(
    page.getByText("Visit status: Requested — awaiting confirmation."),
  ).toBeVisible();
});
test("an unavailable plot link cannot silently become a general enquiry", async ({
  page,
}) => {
  await page.goto("/contact?plot=plot-no-longer-published");
  await expect(page.getByLabel("Selected plot (optional)")).toHaveValue(
    "plot-no-longer-published",
  );
  await expect(
    page.getByText("Choose another plot or a general enquiry."),
  ).toBeVisible();
  await page.getByLabel("Your name *").fill("Synthetic Visitor");
  await page.getByLabel("Phone number *").fill("+91 9000000044");
  await page
    .getByLabel("I consent to being contacted", { exact: false })
    .check();
  let sent = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/enquiries") && request.method() === "POST")
      sent++;
  });
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "selected plot is unavailable",
  );
  expect(sent).toBe(0);
  await page.getByLabel("Selected plot (optional)").selectOption("");
  await expect(page.getByLabel("Selected plot (optional)")).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("contact waits for the connection check before offering a submission", async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/public/project", async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto("/contact", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /Checking connection/ }),
  ).toBeDisabled();
  await expect(page.getByText("Checking the connection…")).toBeVisible();
  await page.getByLabel("Your name *").fill("Synthetic Visitor");
  await expect(page.getByRole("alert")).toHaveCount(0);
  release();
  await expect(
    page.getByRole("button", { name: "Submit enquiry" }),
  ).toBeEnabled();
  await expect(page.getByLabel("Your name *")).toHaveValue("Synthetic Visitor");
});
test("contact validation connects messages and focus to the affected fields", async ({
  page,
}) => {
  await page.goto("/contact");
  await page.getByLabel("Your name *").fill("Synthetic Visitor");
  await page.getByLabel("Phone number *").fill("+91 9000000044");
  const message = page.getByLabel("Message (optional)");
  await message.fill("<markup>");
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  await expect(message).toHaveAttribute("aria-invalid", "true");
  await expect(message).toHaveAttribute("aria-describedby", "error-message");
  await expect(message).toBeFocused();
  await message.fill("A plain text message");
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  const consent = page.getByLabel("I consent to being contacted", {
    exact: false,
  });
  await expect(consent).toHaveAttribute("aria-describedby", "error-consent");
  await expect(consent).toBeFocused();
  await consent.check();
  await page.getByLabel("Request type").selectOption("visit");
  await page
    .getByRole("button", { name: "Request a visit", exact: false })
    .click();
  const date = page.getByLabel("Preferred date *");
  await expect(date).toHaveAttribute("aria-describedby", "error-preferredAt");
  await expect(date).toBeFocused();
});
test("a stalled connection becomes an explicitly unsent offline draft", async ({
  page,
}) => {
  await page.clock.install();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/api/public/project", async (route) => {
    await pending;
    await route.abort().catch(() => {});
  });
  await page.goto("/contact", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /Checking connection/ }),
  ).toBeDisabled();
  await page.clock.fastForward(12_001);
  await expect(
    page.getByText("The backend is unavailable", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Download local draft/ }),
  ).toBeEnabled();
  release();
});

test("a stalled drawing offers a retry", async ({ page }) => {
  await page.clock.install();
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/data/layout.json", async (route) => {
    await pending;
    await route.abort().catch(() => {});
  });
  await page.goto("/explore", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Loading the colony drawing…")).toBeVisible();
  await page.clock.fastForward(12_001);
  await expect(
    page.getByRole("heading", { name: "Unable to load the drawing" }),
  ).toBeVisible();
  release();
  await page.unroute("**/data/layout.json");
  await page.getByRole("button", { name: "Retry layout" }).click();
  await expect(page.locator(".map-area > svg")).toBeVisible();
});

test("a failed refresh keeps previously loaded published mode and marks it stale", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/public/project", async (route) => {
    if (calls++ === 0)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mode: "connected", items: [] }),
      });
    else await route.abort();
  });
  await page.goto("/explore", { waitUntil: "networkidle" });
  await expect(
    page.getByText("Owner-reviewed listings.", { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByText("Inventory refresh failed.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Live inventory is not connected.", { exact: false }),
  ).toHaveCount(0);
});

test("plot-specific forms and comparisons can retry a failed plot drawing", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/data/layout.json", (route) =>
    fail ? route.abort() : route.continue(),
  );
  await page.goto("/contact?plot=plot-1-b26-cell-26");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "The plot list could not be loaded." }),
  ).toBeVisible();
  await page.getByLabel("Your name *").fill("Synthetic Visitor");
  await page.getByLabel("Phone number *").fill("+91 9000000044");
  await page
    .getByLabel("I consent to being contacted", { exact: false })
    .check();
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  await expect(page.locator("#error-plotIds")).toContainText(
    "could not be loaded",
  );
  fail = false;
  await page.getByRole("button", { name: "Retry plot list" }).click();
  await expect(page.getByLabel("Selected plot (optional)")).toHaveValue(
    "plot-1-b26-cell-26",
  );
  await page.evaluate(() =>
    sessionStorage.setItem(
      "sm-compare",
      JSON.stringify(["plot-1-b26-cell-26"]),
    ),
  );
  fail = true;
  await page.goto("/compare");
  await expect(
    page.getByText("The comparison could not load the plot drawing."),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry comparison" }).click();
  await expect(page.getByRole("table")).toContainText("Plan label B26");
});

test("mobile, tablet, landscape and reduced motion remain usable without page overflow", async ({
  page,
}) => {
  for (const size of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/explore");
    if (size.width < 701)
      await page.getByRole("button", { name: /Plot list/ }).click();
    await pick(page, "B26");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator(".details")).toContainText("Approx.");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Take a guided look" }).click();
  await expect(
    page.getByRole("button", { name: "Play", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Exit tour" }).click();
  await page.goto("/contact");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
});
test("touch pan and pinch do not accidentally select another plot", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5181/explore?plot=plot-1-b26-cell-26");
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  await expect(
    page.getByRole("heading", { name: "Plan label B26", exact: true }),
  ).toBeVisible();
  const svg = page.locator(".map-area > svg");
  const box = await svg.boundingBox();
  await page.evaluate(() =>
    document.querySelector(".map-area").scrollIntoView({ block: "center" }),
  );
  const b = await svg.boundingBox();
  const session = await context.newCDPSession(page),
    x = b.x + b.width * 0.5,
    y = b.y + b.height * 0.5;
  const before = await svg.getAttribute("viewBox");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 35, y, id: 1 },
      { x: x + 35, y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 65, y, id: 1 },
      { x: x + 65, y, id: 2 },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  expect(await svg.getAttribute("viewBox")).not.toBe(before);
  await expect(
    page.getByRole("heading", { name: "Plan label B26", exact: true }),
  ).toBeVisible();
  expect(box.width).toBeGreaterThan(250);
  await context.close();
});
test("mobile plot labels avoid the controls and plan view needs no WebGL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).startsWith("webgl"))
        throw new Error("WebGL unavailable in this test");
      return original.call(this, type, ...args);
    };
  });
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await expect(page.locator(".cell.selected")).toHaveCount(1);
  await expect(page.locator(".plot-label", { hasText: "B26" })).toBeVisible();
  const overlaps = await page.evaluate(() => {
    const controls = [...document.querySelectorAll(".map-controls button")].map(
      (el) => el.getBoundingClientRect(),
    );
    return [...document.querySelectorAll(".plot-label")].some((label) => {
      const a = label.getBoundingClientRect();
      return controls.some(
        (b) =>
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top,
      );
    });
  });
  expect(overlaps).toBe(false);
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  await expect(page.locator(".cell.selected")).toHaveCount(1);
  await page.getByRole("button", { name: "Source drawing" }).click();
  await expect(page.locator(".cell.selected")).toHaveCount(1);
});
test("primary Hindi explorer and contact controls remain readable on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore");
  await page.getByRole("button", { name: "Switch to Hindi" }).click();
  await expect(
    page.getByRole("button", { name: "2D योजना (मूल नक्शा)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "प्लॉट सूची (556)" }),
  ).toBeVisible();
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await expect(page.locator(".detail-actions")).toBeVisible();
  const sizes = await page
    .locator(".detail-actions button")
    .evaluateAll((buttons) =>
      buttons.map((button) => ({
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
      })),
    );
  expect(
    sizes.every((size) => size.width >= 100 && size.height >= 44),
  ).toBeTruthy();
  await page.goto("/contact?type=visit");
  await expect(page.getByLabel("आपका नाम *")).toBeVisible();
  await expect(page.getByLabel("पसंदीदा तारीख *")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("network layout error has a retry and static alternative; offline forms download only", async ({
  page,
}) => {
  await page.route("**/data/layout.json", (r) => r.abort());
  await page.goto("/explore");
  await expect(
    page.getByRole("heading", { name: "Unable to load the drawing" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open the static drawing" }),
  ).toBeVisible();
  await page.unroute("**/data/layout.json");
  await page.getByRole("button", { name: "Retry layout" }).click();
  await expect(page.locator(".map-area > svg")).toBeVisible();
  await page.route("**/api/**", (r) => r.abort());
  await page.goto("/contact");
  await expect(
    page.getByRole("button", { name: "Download local draft" }),
  ).toBeVisible();
  await expect(
    page.getByText("A local draft does not check the current plot status."),
  ).toBeVisible();
  await page.getByLabel("Your name *").fill("Local Synthetic");
  await page.getByLabel("Phone number *").fill("+91 9000000000");
  await page
    .getByLabel("I consent to being contacted", { exact: false })
    .check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download local draft" }).click();
  await download;
  await expect(
    page.getByText(
      "Draft downloaded to this device. Nothing was sent to the colony team.",
    ),
  ).toBeVisible();
});
test("owner review UI stages identity, reviews, publishes and restores approved route", async ({
  page,
}) => {
  await page.goto("/admin");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill("Synthetic-test-only-927156!");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Data review", exact: true }),
  ).toBeVisible();
  const ownerSession = await (
    await page.request.get("/api/auth/session")
  ).json();
  const documentResponse = await page.request.put(
    "/api/admin/content/e2e-plot-document",
    {
      headers: {
        Origin: "http://127.0.0.1:5181",
        "X-CSRF-Token": ownerSession.csrf,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        kind: "media",
        expectedVersion: 0,
        publish: true,
        reason: "Synthetic plot document review",
        data: {
          title: "Synthetic plot document",
          description: "Test only",
          url: "/assets/survey-plan-north.png",
          category: "document",
          revision: "TEST",
          source: "Synthetic test source",
          verifiedAt: new Date().toISOString(),
        },
      },
    },
  );
  expect(documentResponse.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Data review", exact: true }).click();
  await page.getByLabel("Find a draft cell").fill("B24");
  await page.getByRole("button", { name: /B24 PLOT 1/ }).click();
  await expect(page.getByLabel("Approved block")).toHaveValue("");
  await expect(page.getByLabel("Approved plot number")).toHaveValue("");
  await page.getByLabel("Approved plot number").fill("TEST-E2E-24");
  await page.getByLabel("Approved block").fill("TEST-B");
  await page
    .getByLabel("Published document IDs", { exact: false })
    .fill("e2e-plot-document");
  await page
    .getByLabel("Document revision / date")
    .fill("Synthetic E2E revision");
  await page
    .getByLabel("Review evidence / reason")
    .fill("Synthetic browser test; not an owner-approved real plot.");
  await page.getByRole("button", { name: "Save identity draft" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Identity staged" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page
    .getByLabel("Choose a record")
    .selectOption({ label: "TEST-B / TEST-E2E-24 · draft · unverified" });
  await page.getByLabel("Publication transition").selectOption("reviewed");
  await page
    .getByLabel("Reason for change")
    .fill("Synthetic review for browser workflow");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByText("Current publication: reviewed", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Publication transition").selectOption("published");
  await page
    .getByLabel("Reason for change")
    .fill("Synthetic publication in test database only");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(
    page.getByText("Current publication: published", { exact: false }),
  ).toBeVisible();
  await page.goto("/explore");
  await page
    .getByPlaceholder("Try a plot number, e.g. B26")
    .fill("TEST-E2E-24");
  await page
    .getByRole("button", { name: /Plot TEST-E2E-24 Block TEST-B/ })
    .click();
  await expect(page).toHaveURL(/\/plots\/[a-f0-9-]+/);
  await expect(
    page.getByRole("heading", { name: "Plot TEST-E2E-24", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Plot TEST-E2E-24", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".details .badge")).toContainText(
    "Availability unverified",
  );
  await expect(
    page.getByRole("link", { name: "Synthetic plot document" }),
  ).toBeVisible();
  const unpublishedDocument = await page.request.put(
    "/api/admin/content/e2e-plot-document",
    {
      headers: {
        Origin: "http://127.0.0.1:5181",
        "X-CSRF-Token": ownerSession.csrf,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        kind: "media",
        expectedVersion: 1,
        publish: false,
        reason: "Synthetic document withdrawal",
        data: {
          title: "Synthetic plot document",
          description: "Test only",
          url: "/assets/survey-plan-north.png",
          category: "document",
          revision: "TEST",
          source: "Synthetic test source",
          verifiedAt: new Date().toISOString(),
        },
      },
    },
  );
  expect(unpublishedDocument.ok()).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Synthetic plot document" }),
  ).toHaveCount(0);
  const id = new URL(page.url()).pathname.split("/").pop();
  const session = await (await page.request.get("/api/auth/session")).json();
  const records = await (await page.request.get("/api/admin/plots")).json();
  const record = records.plots.find((item) => item.id === id);
  const statusChange = await page.request.patch(`/api/admin/plots/${id}`, {
    headers: {
      Origin: "http://127.0.0.1:5181",
      "X-CSRF-Token": session.csrf,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      expectedVersion: record.version,
      status: "available",
      reason: "Synthetic owner availability review",
    },
  });
  expect(statusChange.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator(".details .badge")).toContainText(
    "Verified available",
  );
  await expect(page.locator(".cell.selected")).toHaveClass(/status-available/);
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  const availablePath = await page.locator(".cell.selected").getAttribute("d");
  expect(
    await page
      .locator("#plot-texture-mask-available path")
      .evaluateAll(
        (paths, d) => paths.some((path) => path.getAttribute("d") === d),
        availablePath,
      ),
  ).toBe(true);
  expect(
    await page
      .locator(".cell.selected")
      .evaluate((el) => getComputedStyle(el).fill),
  ).toBe("rgb(168, 213, 162)");
  await expect(page.locator(".selection-outline")).toHaveAttribute(
    "d",
    availablePath,
  );
  await page.getByRole("button", { name: "＋ Compare" }).click();
  await page.getByRole("link", { name: "Compare (1/3)" }).click();
  await expect(page.getByRole("table")).toContainText("Verified available");
  await page.goBack();
  const availableRecord = (
    await (await page.request.get("/api/admin/plots")).json()
  ).plots.find((item) => item.id === id);
  const reserve = await page.request.patch(`/api/admin/plots/${id}`, {
    headers: {
      Origin: "http://127.0.0.1:5181",
      "X-CSRF-Token": session.csrf,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      expectedVersion: availableRecord.version,
      status: "reserved",
      reason: "Synthetic reservation review",
    },
  });
  expect(reserve.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator(".details .badge")).toContainText(
    "Verified reserved",
  );
  const selectedCell = page.locator(".cell.selected");
  await expect(selectedCell).toHaveClass(/status-reserved/);
  expect(
    await selectedCell.evaluate((element) => getComputedStyle(element).fill),
  ).toBe("rgb(246, 197, 138)");
  expect(
    await selectedCell.evaluate((element) => getComputedStyle(element).stroke),
  ).toBe("rgb(184, 137, 39)");
  await page.getByRole("link", { name: "Compare (1/3)" }).click();
  await expect(page.getByRole("table")).toContainText("Verified reserved");
  await page.goBack();
  await page.getByRole("button", { name: "Enquire about this plot" }).click();
  await expect(page.getByLabel("Selected plot (optional)")).toContainText(
    "TEST-E2E-24",
  );
  await expect(page.getByLabel("Selected plot (optional)")).toHaveValue(id);
  await page.reload();
  await expect(page.getByLabel("Selected plot (optional)")).toHaveValue(id);
  await page.getByLabel("Your name *").fill("Synthetic Approved Buyer");
  await page.getByLabel("Phone number *").fill("+91 9000000045");
  await page
    .getByLabel("I consent to being contacted", { exact: false })
    .check();
  const approvedRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/enquiries") && request.method() === "POST",
  );
  await page.getByRole("button", { name: "Submit enquiry" }).click();
  expect((await approvedRequest).postDataJSON().plotIds).toEqual([id]);
  await expect(
    page.getByRole("status").filter({ hasText: "Reference:" }),
  ).toBeVisible();
  const leads = await (await page.request.get("/api/admin/enquiries")).json();
  expect(
    leads.enquiries.find(
      (lead) => lead.data.name === "Synthetic Approved Buyer",
    ).data.plots[0].id,
  ).toBe(id);
  // Restore the plot without animation, then wait for its actual fitted camera.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goBack();
  await expect(page.locator(".cell.selected")).toHaveAttribute("data-plot", id);
  await page.waitForFunction(() => {
    const svg = document.querySelector(".map-area > svg");
    const selected = svg?.querySelector(".cell.selected");
    if (!svg || !selected) return false;
    const bounds = selected.getBBox();
    const width = Math.max(bounds.width, 18);
    const height = Math.max(bounds.height, 18);
    const expected = [bounds.x - width * 0.7, bounds.y - height * 0.7, width * 2.4, height * 2.4];
    const actual = svg.getAttribute("viewBox").split(/\s+/).map(Number);
    // Rendered paths round coordinates; the camera uses unrounded plot bounds.
    return actual.length === 4 && actual.every((value, index) => Math.abs(value - expected[index]) < 0.001);
  });
  const pathBefore = await page.locator(".cell.selected").getAttribute("d");
  const viewBefore = await page.locator(".map-area > svg").getAttribute("viewBox");
  await expect(page.getByRole("button", { name: "Illustrated colony" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "2D plan (Source drawing)" }).click();
  await expect(page.getByRole("button", { name: "2D plan (Source drawing)" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".map-area > svg").getAttribute("viewBox")).toBe(viewBefore);
  await expect(page.locator(".cell.selected")).toHaveAttribute("data-plot", id);
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  await expect(page.locator(".map-panel")).toHaveClass(/view-colony/);
  expect(await page.locator(".cell.selected").getAttribute("d")).toBe(pathBefore);
  expect(await page.locator(".map-area > svg").getAttribute("viewBox")).toBe(viewBefore);
  await expect(page.locator(".cell.selected")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Back to this plot in explorer" })
    .click();
  await expect(page).toHaveURL(/\/explore\?plot=/);
  await expect(page.locator(".cell.selected")).toHaveCount(1);
  await page.getByRole("button", { name: "Back to full colony" }).click();
  await page.getByText("Browse approved blocks", { exact: false }).click();
  await page.getByLabel("Search blocks").fill("TEST-B");
  await page.getByRole("button", { name: /Block TEST-B \(1\)/ }).click();
  await expect(page).toHaveURL(/block=TEST-B/);
  await expect(page.locator(".plot-row")).toHaveCount(1);
  await expect(page.locator(".cell.block-active")).toHaveCount(1);
  await page.getByText("Filter plots", { exact: true }).click();
  await page.getByLabel("Status", { exact: true }).selectOption("reserved");
  await expect(page.locator(".plot-row")).toContainText("reserved");
  await page.getByLabel("Status", { exact: true }).selectOption("unverified");
  await expect(page.locator(".plot-row")).toHaveCount(0);
  await page.getByLabel("Status", { exact: true }).selectOption("");
  await page.reload();
  await expect(page.locator(".plot-row")).toHaveCount(1);
  const current = (
    await (await page.request.get("/api/admin/plots")).json()
  ).plots.find((item) => item.id === id);
  await page.goto("/admin");
  await page.getByRole("button", { name: "CSV import" }).click();
  await page
    .getByLabel("Inventory CSV content")
    .fill(
      `approvedPlotId,expectedVersion,status,priceINR,priceVisible,reason\n${id},${current.version},sold,,,Synthetic CSV status review\n`,
    );
  await page.getByRole("button", { name: "Preview inventory changes" }).click();
  await expect(
    page.getByText("1 valid / 1 rows", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Commit inventory changes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Inventory updates committed" }),
  ).toBeVisible();
  await page.goto(`/plots/${id}`);
  await expect(page.locator(".details .badge")).toContainText("Verified sold");
  await expect(page.locator(".cell.selected")).toHaveClass(/status-sold/);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Audit history" }).click();
  await page.getByLabel("Filter by entity ID").fill(id);
  await page.getByRole("button", { name: "Filter history" }).click();
  await expect(page.locator(".audit-event").first()).toBeVisible();
});

test("published amenity appears at its reviewed map position and hidden content stays private", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:5181";
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "owner@example.invalid",
      password: "Synthetic-test-only-927156!",
    },
  });
  expect(login.ok()).toBeTruthy();
  const { csrf } = await login.json();
  const headers = {
    Origin: origin,
    "X-CSRF-Token": csrf,
    "Idempotency-Key": crypto.randomUUID(),
  };
  const data = {
    title: "Synthetic test garden",
    titleHi: "परीक्षण उद्यान",
    description: "Synthetic test placement only.",
    category: "garden",
    location: { lat: 24.466, lon: 74.909 },
    customerVisible: true,
    state: "planned",
    source: "Synthetic test source",
    verifiedAt: new Date().toISOString(),
    imageUrl: "",
    imageKind: "illustration",
  };
  const save = await page.request.put("/api/admin/content/e2e-garden", {
    headers,
    data: {
      kind: "amenity",
      data,
      expectedVersion: 0,
      publish: true,
      reason: "Synthetic browser placement test",
    },
  });
  expect(save.ok()).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/amenities");
  await page
    .getByRole("article")
    .filter({ hasText: "Synthetic test garden" })
    .getByRole("link", { name: "Show on map" })
    .click();
  await expect(page.locator('[data-amenity="e2e-garden"]')).toHaveCount(1);
  await expect(page.locator(".map-amenity-card")).toContainText(
    "Synthetic test garden",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const hidden = await page.request.put("/api/admin/content/e2e-garden", {
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    data: {
      kind: "amenity",
      data: { ...data, customerVisible: false },
      expectedVersion: 1,
      publish: true,
      reason: "Synthetic visibility review",
    },
  });
  expect(hidden.ok()).toBeTruthy();
  const project = await (await page.request.get("/api/public/project")).json();
  expect(project.items.some((item) => item.id === "e2e-garden")).toBeFalsy();
  await page.goto("/admin");
  await page.getByRole("button", { name: "Content", exact: true }).click();
  const editor = page
    .locator("details.admin-card")
    .filter({ hasText: "Add content" });
  await editor.locator("summary").click();
  await editor
    .getByLabel("Replace image", { exact: false })
    .setInputFiles("public/assets/plot-dimensions-example.png");
  await editor.getByRole("button", { name: "Stage image" }).click();
  await expect(
    editor.getByAltText("Image staged for owner review"),
  ).toBeVisible();
});

test("owner can preview, save and publish a visual-only plot placement", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:5181";
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "owner@example.invalid",
      password: "Synthetic-test-only-927156!",
    },
  });
  expect(login.ok()).toBeTruthy();
  const published = (
    await (
      await page.request.get("/api/public/plots?limit=600&offset=0")
    ).json()
  ).plots;
  const plot = published.find((entry) => entry.label === "TEST-E2E-24");
  expect(plot).toBeTruthy();
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "Illustrated layout", exact: true })
    .click();
  await page.getByLabel("Plot record and source mapping").selectOption(plot.id);
  await page.getByLabel("Uniform visual scale").fill("0.85");
  await page.getByLabel("Horizontal offset").fill("3");
  await expect(
    page.getByText(
      "Review its relationship to roads and neighbouring plots before publishing.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add placement to draft" }).click();
  await page
    .getByLabel("Reviewed at (ISO date/time, required to publish)")
    .fill(new Date().toISOString());
  await page
    .getByLabel("Reason for change")
    .fill("Synthetic illustration placement review");
  await page.getByRole("button", { name: "Save layout draft" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Illustrated layout draft saved" }),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/public/project")).json()).items.some(
      (item) => item.id === "illustrated-layout",
    ),
  ).toBe(false);
  await page
    .getByLabel("Reason for change")
    .fill("Synthetic owner publication review");
  await page.getByRole("button", { name: "Publish reviewed draft" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Illustrated layout published" }),
  ).toBeVisible();
  const result = (
    await (await page.request.get("/api/public/project")).json()
  ).items.find((item) => item.id === "illustrated-layout");
  expect(result.published.placements[0]).toMatchObject({
    plotId: plot.id,
    geometryId: plot.geometryId,
    scale: 0.85,
    dx: 3,
  });
  await page.goto(`/plots/${plot.id}`);
  const cell = page.locator(".cell.selected");
  await expect(cell).toHaveAttribute("data-plot", plot.id);
  expect(await cell.getAttribute("d")).not.toBe(plot.path);
  await expect(page.locator(`[data-plot-hit="${plot.id}"]`)).toHaveAttribute(
    "d",
    await cell.getAttribute("d"),
  );
  await expect(page.locator(".details")).toContainText("Verified sold");
  await page.getByRole("button", { name: "Source drawing" }).click();
  await expect(cell).toHaveAttribute("d", plot.path);
  await page.getByRole("button", { name: "Original plan" }).click();
  await expect(page.locator(".original-plan-view img")).toBeVisible();
  await expect(cell).toHaveAttribute("data-plot", plot.id);
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  expect(await cell.getAttribute("d")).not.toBe(plot.path);
  await expect(page.locator(".details")).toContainText("Verified sold");
});

for (const ref of ownerAmenityReferences.filter(
  (item) => !item.internalVisual && item.image && !item.mapNative,
))
  test(`concept image ${ref.id} stays attached to its map area and opens its card`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const images = [];
    page.on("request", (request) => {
      if (request.url().includes("/assets/concepts/"))
        images.push(request.url());
    });
    await page.goto("/explore");
    await expect(page.locator(".amenity-marker")).toHaveCount(
      ownerAmenityReferences.filter((item) => !item.internalVisual).length,
    );
    await expect(page.locator("[data-amenity-image]")).toHaveCount(
      ownerAmenityReferences.filter(
        (item) => !item.internalVisual && item.image && !item.mapNative,
      ).length,
    );
    await expect
      .poll(
        () => new Set(images.filter((url) => url.endsWith("-map.webp"))).size,
      )
      .toBeGreaterThanOrEqual(8);
    await page.getByText("Explore amenities", { exact: false }).click();
    await page.getByRole("button", { name: ref.title, exact: true }).click();
    const marker = page.locator(`[data-amenity="${ref.id}"]`);
    await expect(page.locator(".map-amenity-card")).toContainText(ref.title);
    await expect(page.locator(".map-amenity-card")).toContainText(
      "Approximate location",
    );
    await expect(page.locator(".map-amenity-card")).toContainText(
      "Illustrative concept",
    );
    await expect(marker).toHaveClass(/active/);
    expect(
      await marker.evaluate((element, data) => {
        const svg = element.ownerSVGElement,
          point = new DOMPoint(data.mapPoint.x, data.mapPoint.y);
        return data.areaIds.some((id) =>
          svg.querySelector(`[data-area="${id}"]`).isPointInFill(point),
        );
      }, ref),
    ).toBe(true);
    const image = marker.locator("image");
    await expect(image).toHaveAttribute(
      "href",
      `/assets/concepts/${(ref.foreground?.image || ref.image).replace(/\.png$/, "-map.webp")}`,
    );
    const transform = await marker.locator("g").getAttribute("transform"),
      view = await page.locator(".map-area > svg").getAttribute("viewBox");
    await page.getByRole("button", { name: "Illustrated colony" }).click();
    expect(await marker.locator("g").getAttribute("transform")).toBe(transform);
    expect(await page.locator(".map-area > svg").getAttribute("viewBox")).toBe(
      view,
    );
    await page.getByRole("button", { name: "Source drawing" }).click();
    await page.getByRole("button", { name: "Close amenity details" }).click();
    const point = await marker.evaluate((element, data) => {
      const result = new DOMPoint(
        data.mapPoint.x,
        data.mapPoint.y,
      ).matrixTransform(element.ownerSVGElement.getScreenCTM());
      return { x: result.x, y: result.y };
    }, ref);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator(".map-amenity-card")).toContainText(ref.title);
    await page.getByRole("button", { name: "Back to full map" }).click();
    expect(images.some((url) => url.endsWith("/fountain.png"))).toBeFalsy();
    await page.route("**/api/public/project", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ mode: "connected", items: [] }),
      }),
    );
    await page.reload();
    await expect(page.locator(".amenity-marker")).toHaveCount(0);
  });

test("concept overlays retain map coordinates on mobile and fall back when images fail", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/fountain-center-map.webp", (route) => route.abort());
  await page.goto("/explore?amenity=owner-ref-fountain");
  const marker = page.locator('[data-amenity="owner-ref-fountain"]');
  await expect(marker.locator("image")).toHaveAttribute(
    "href",
    "/assets/concepts/fountain-center.png",
  );
  const transform = await marker.locator("g").getAttribute("transform");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  expect(await marker.locator("g").getAttribute("transform")).toBe(transform);
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await marker.locator("g").getAttribute("transform")).toBe(transform);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.getByLabel("Amenities", { exact: true }).uncheck();
  await expect(page.locator("[data-amenity-image]")).toHaveCount(0);
  await page.getByLabel("Amenities", { exact: true }).check();
  await expect(page.locator("[data-amenity-image]")).toHaveCount(
    ownerAmenityReferences.filter(
      (item) => !item.internalVisual && item.image && !item.mapNative,
    ).length,
  );
  await page.route("**/fountain-center.png", (route) => route.abort());
  await page.reload();
  await expect(marker.locator("circle")).toHaveCount(1);
  await page.locator(".map-amenity-card").scrollIntoViewIfNeeded();
  await expect(page.locator(".map-amenity-card")).toContainText(
    "Image temporarily unavailable.",
  );
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
});

test("a plot next to the amenity images remains directly selectable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore?amenity=owner-ref-temple");
  await expect(
    page.locator('[data-amenity-image="owner-ref-temple"]'),
  ).toHaveCount(1);
  await page.locator('[data-plot="plot-6-390-cell-17"]').click();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-6-390-cell-17",
  );
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-6-390-cell-17",
  );
  await expect(page.locator(".area-value")).toContainText("Approx.");
});

test("the shared visual respects individual publication, surveyed locations and owner images", async ({
  page,
}) => {
  const ids = [
    "owner-ref-temple",
    "owner-ref-garden",
    "owner-ref-temple-garden-visual",
  ];
  const records = ownerAmenityReferences
    .filter((ref) => ids.includes(ref.id))
    .map((ref) => ({
      id: ref.id,
      kind: "amenity",
      published: {
        ...previewAmenity(ref),
        mapPoint: ref.mapPoint,
        customerVisible: true,
      },
    }));
  let items = records;
  await page.route("**/api/public/project", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ mode: "connected", items }),
    }),
  );
  await page.goto("/explore");
  await expect(page.locator("[data-shared-amenity-art]")).toHaveCount(1);
  await expect(
    page.getByText("Explore amenities", { exact: false }),
  ).toContainText("(2)");
  items = records.filter((record) => record.id !== "owner-ref-garden");
  await page.reload();
  await expect(page.locator("[data-shared-amenity-art]")).toHaveCount(0);
  await expect(
    page.locator('[data-amenity-image="owner-ref-temple"]'),
  ).toHaveCount(1);
  await expect(page.locator('[data-amenity="owner-ref-garden"]')).toHaveCount(
    0,
  );
  items = records.map((record) =>
    record.id === "owner-ref-temple"
      ? {
          ...record,
          published: {
            ...record.published,
            imageUrl: "/assets/plot-dimensions-example.png",
          },
        }
      : record,
  );
  await page.reload();
  await expect(page.locator("[data-shared-amenity-art]")).toHaveCount(0);
  await expect(
    page.locator('[data-amenity-image="owner-ref-temple"]'),
  ).toHaveAttribute("href", "/assets/plot-dimensions-example.png");
  items = records.map((record) =>
    record.id === "owner-ref-garden"
      ? {
          ...record,
          published: { ...record.published, placementPrecision: "surveyed" },
        }
      : record,
  );
  await page.reload();
  await expect(page.locator("[data-shared-amenity-art]")).toHaveCount(0);
  await expect(
    page.locator('[data-amenity-image="owner-ref-garden"]'),
  ).toHaveCount(1);
});

test("fitted concepts retain their visible artwork inside their mapped areas", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore");
  await expect(page.locator("[data-amenity-art-frame]")).toHaveCount(
    ownerAmenityReferences.filter(
      (item) => !item.internalVisual && item.image && !item.mapNative,
    ).length,
  );
  for (const reference of ownerAmenityReferences.filter(
    (ref) => !ref.internalVisual && ref.image && !ref.mapNative,
  )) {
    const result = await page.evaluate(
      async (ref) => {
        const root = document.querySelector(".map-area > svg");
        const image = root.querySelector(`[data-amenity-image="${ref.id}"]`);
        const frame = image.closest("[data-amenity-art-frame]");
        const clip = root.querySelector(`#amenity-clip-${ref.id}`);
        const areas = [...clip.querySelectorAll("path")];
        const roads = [...root.querySelectorAll(".area.road")];
        const plots = [...root.querySelectorAll(".cell")].filter((plot) => {
          const box = plot.getBBox();
          return (
            Math.abs(box.x + box.width / 2 - ref.mapPoint.x) <
              ref.mapSize[0] + box.width &&
            Math.abs(box.y + box.height / 2 - ref.mapPoint.y) <
              ref.mapSize[1] + box.height
          );
        });
        const source = new Image();
        source.src = `/assets/concepts/${ref.image}`;
        await source.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 192;
        canvas.height = Math.round((192 * source.height) / source.width);
        const context = canvas.getContext("2d");
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        const toPlan = root
          .getScreenCTM()
          .inverse()
          .multiply(image.getScreenCTM());
        const box = frame.viewBox.baseVal;
        let total = 0,
          visible = 0,
          onRoad = 0,
          onPlot = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
            total++;
            const ix = (x * ref.imageSize[0]) / canvas.width;
            const iy = (y * ref.imageSize[1]) / canvas.height;
            if (
              ix < box.x ||
              ix > box.x + box.width ||
              iy < box.y ||
              iy > box.y + box.height
            ) {
              continue;
            }
            const point = new DOMPoint(ix, iy).matrixTransform(toPlan);
            if (areas.some((area) => area.isPointInFill(point))) {
              visible++;
              if (roads.some((road) => road.isPointInFill(point))) onRoad++;
              if (plots.some((plot) => plot.isPointInFill(point))) onPlot++;
            }
          }
        }
        return { total, visible, onRoad, onPlot };
      },
      reference.foreground
        ? { ...reference, ...reference.foreground }
        : reference,
    );
    expect(result.total).toBeGreaterThan(1000);
    expect(
      result.visible,
      `${reference.id} visible inside clip`,
    ).toBeGreaterThan(100);
    expect(result.onPlot, `${reference.id} overlaps a plot`).toBe(0);
    if (reference.id !== "owner-ref-entry-gate")
      expect(result.onRoad, `${reference.id} overlaps a road`).toBe(0);
  }
  await expect(
    page.locator('[data-amenity-art-frame="owner-ref-temple"]'),
  ).toHaveCount(1);
  await expect(page.locator('[data-amenity="owner-ref-garden"]')).toHaveCount(
    1,
  );
});

test("landscape ground follows source polygons and excludes roads and plots", async ({
  page,
}) => {
  await page.goto("/explore");
  const areas = [
    "area-2",
    "area-3",
    "area-30",
    "area-40",
    "area-41",
    "area-42",
    "area-43",
    "area-44",
  ];
  await expect(page.locator("[data-amenity-ground]")).toHaveCount(areas.length);
  for (const id of areas) {
    const ground = page.locator(`[data-amenity-ground="${id}"]`);
    await expect(ground).toHaveAttribute(
      "d",
      await page.locator(`[data-area="${id}"]`).getAttribute("d"),
    );
    await expect(ground).toHaveAttribute(
      "mask",
      "url(#amenity-ground-exclusion)",
    );
    await expect(ground).toHaveAttribute("pointer-events", "none");
  }
  expect(
    await page.locator("#amenity-ground-exclusion path").count(),
  ).toBeGreaterThanOrEqual(3);
  await page.getByLabel("Amenities", { exact: true }).uncheck();
  await expect(page.locator("[data-amenity-ground]")).toHaveCount(0);
  await page.getByLabel("Amenities", { exact: true }).check();
  await expect(page.locator("[data-amenity-ground]")).toHaveCount(areas.length);
  await page.getByRole("button", { name: "Source drawing" }).click();
  await expect(page.locator("[data-amenity-ground]")).toHaveCount(areas.length);
});

test("illustrative surfaces use the unchanged road and plot polygons without markings or false availability", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await page.getByRole("button", { name: "Source drawing" }).click();
  const selected = page.locator(".cell.selected");
  await expect(selected).toHaveClass(/status-unverified/);
  const d = await selected.getAttribute("d");
  await expect(page.locator("[data-plot-texture-layer]")).toHaveCount(0);
  await expect(page.locator("[data-road-texture]")).toHaveCount(0);
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  const illustratedPath = await selected.getAttribute("d");
  expect(illustratedPath).not.toBe(d);
  await expect(page.locator("[data-road-texture]")).toHaveCount(2);
  await expect(page.locator("#plot-texture-mask-neutral path")).toHaveCount(
    556,
  );
  expect(
    await page
      .locator("#plot-texture-mask-neutral path")
      .evaluateAll(
        (paths, selectedPath) =>
          paths.some((path) => path.getAttribute("d") === selectedPath),
        illustratedPath,
      ),
  ).toBe(true);
  await expect(page.locator(".selection-outline")).toHaveAttribute(
    "d",
    illustratedPath,
  );
  expect(
    await selected.evaluate((element) => getComputedStyle(element).fill),
  ).not.toBe("rgb(168, 213, 162)");
  await expect(page.locator(".legend")).toContainText("Unverified");
  await expect(page.locator(".legend")).toContainText("Verified available");
  await expect(page.locator(".map-footnote")).toContainText("surfaces");
  await expect(page.locator(".dimension text").first()).toContainText(
    "Approx.",
  );
  for (const area of ["area-1", "area-31"]) {
    expect(
      await page.locator(`[data-road-texture="${area}"]`).getAttribute("d"),
    ).toBe(await page.locator(`[data-area="${area}"]`).getAttribute("d"));
  }
  const markings = await page.evaluate(async () => {
    const image = new Image();
    image.src = "/assets/textures/road-texture.webp";
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 240;
    const context = canvas.getContext("2d");
    context.drawImage(
      image,
      (150 * image.width) / 1024,
      (150 * image.height) / 1536,
      (240 * image.width) / 1024,
      (240 * image.height) / 1536,
      0,
      0,
      240,
      240,
    );
    const pixels = context.getImageData(0, 0, 240, 240).data;
    let maxBrightColumn = 0;
    for (let x = 0; x < 240; x++) {
      let count = 0;
      for (let y = 0; y < 240; y++) {
        const i = (y * 240 + x) * 4;
        if (Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 200) count++;
      }
      maxBrightColumn = Math.max(maxBrightColumn, count);
    }
    return maxBrightColumn;
  });
  expect(markings).toBeLessThan(24);
  const view = await page.locator(".map-area > svg").getAttribute("viewBox");
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(
    await page.locator(".map-area > svg").getAttribute("viewBox"),
  ).not.toBe(view);
  await expect(selected).toHaveAttribute("d", illustratedPath);
  await page.getByRole("button", { name: "Source drawing" }).click();
  await expect(page.locator("[data-plot-texture-layer]")).toHaveCount(0);
  await expect(selected).toHaveAttribute("d", d);
});

test("plot selection remains usable when optional textures cannot load", async ({
  page,
}) => {
  await page.route("**/assets/textures/**", (route) => route.abort());
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await page.getByRole("button", { name: "Illustrated colony" }).click();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
  await expect(page.locator(".details")).toContainText("Approx.");
  await page.getByRole("button", { name: "Source drawing" }).click();
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b26-cell-26",
  );
});

test("the landscaped inset leaves the original parcel hit area usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/explore?plot=plot-1-b26-cell-26");
  await expect(
    page.locator('[data-plot-hit="plot-1-b25-cell-25"]'),
  ).toHaveCount(1);
  const point = await page.evaluate(() => {
    const id = "plot-1-b25-cell-25";
    const source = document.querySelector(`[data-plot-hit="${id}"]`);
    const visible = document.querySelector(`[data-plot="${id}"]`);
    const bounds = source.getBBox();
    for (let y = bounds.y; y <= bounds.y + bounds.height; y += 0.15)
      for (let x = bounds.x; x <= bounds.x + bounds.width; x += 0.15) {
        const point = new DOMPoint(x, y);
        if (!source.isPointInFill(point) || visible.isPointInFill(point))
          continue;
        const screen = point.matrixTransform(source.getScreenCTM());
        if (
          document
            .elementFromPoint(screen.x, screen.y)
            ?.getAttribute("data-plot-hit") === id
        )
          return { x: screen.x, y: screen.y };
      }
    return null;
  });
  expect(point).toBeTruthy();
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".cell.selected")).toHaveAttribute(
    "data-plot",
    "plot-1-b25-cell-25",
  );
});

test("mobile navigation and map layer controls have comfortable touch targets", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explore");
  for (const button of [
    "Menu",
    "Switch to Hindi",
    "2D plan (Source drawing)",
    "Illustrated colony",
    "Original plan",
  ]) {
    const target = page.getByRole("button", {
      name: button,
      exact: button !== "Menu",
    });
    await expect(target).toBeVisible();
    expect((await target.boundingBox()).height, button).toBeGreaterThanOrEqual(
      44,
    );
    expect((await target.boundingBox()).width, button).toBeGreaterThanOrEqual(
      44,
    );
  }
  for (const label of ["Numbers", "Dimensions", "Boundary", "Amenities"]) {
    const target = page.getByLabel(label, { exact: true }).locator("..");
    expect((await target.boundingBox()).height, label).toBeGreaterThanOrEqual(
      44,
    );
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.goto("/explore?amenity=owner-ref-temple");
  const close = page.getByRole("button", { name: "Close amenity details" });
  await expect(close).toBeVisible();
  expect((await close.boundingBox()).width).toBeGreaterThanOrEqual(44);
});

test("owner can stage, adjust and publish an approximate amenity without overwriting a draft", async ({
  page,
}) => {
  const origin = "http://127.0.0.1:5181";
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: origin },
    data: {
      email: "owner@example.invalid",
      password: "Synthetic-test-only-927156!",
    },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/admin");
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await page
    .getByRole("button", { name: "Stage owner-indicated amenities" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "references staged" }),
  ).toBeVisible();
  const editor = page
    .locator("details.admin-card")
    .filter({ hasText: "owner-ref-garden" });
  await editor.locator("summary").click();
  await expect(editor.getByLabel("Source", { exact: true })).toHaveValue(
    "Owner-provided screenshot reference",
  );
  await editor.getByRole("button", { name: "Adjust position on plan" }).click();
  const picker = editor.locator(".position-editor > svg");
  await expect(picker).toBeVisible();
  const detailBox = (await picker.getAttribute("viewBox"))
    .split(" ")
    .map(Number);
  await editor
    .getByRole("button", { name: "Show entire reference area" })
    .click();
  const fullBox = (await picker.getAttribute("viewBox")).split(" ").map(Number);
  expect(fullBox[2]).toBeGreaterThan(detailBox[2]);
  await editor.getByRole("button", { name: "Focus current position" }).click();
  await picker.click({ position: { x: 5, y: 5 } });
  await expect(editor.getByRole("alert")).toContainText(
    "inside the highlighted",
  );
  const longitude = editor.getByLabel("Amenity longitude");
  const before = await longitude.inputValue();
  await picker.focus();
  await page.keyboard.press("ArrowRight");
  await expect(longitude).not.toHaveValue(before);
  await editor.getByLabel("Marker scale").fill("1.3");
  await editor.getByLabel("Marker rotation (degrees)").fill("-15");
  const liveFrame = picker.locator(
    '[data-amenity-art-frame="owner-ref-garden"]',
  );
  expect(Number(await liveFrame.getAttribute("width"))).toBeCloseTo(
    ownerAmenityReferences.find((item) => item.id === "owner-ref-garden")
      .foreground.mapSize[0] * 1.3,
  );
  await expect(liveFrame.locator("..")).toHaveAttribute(
    "transform",
    /rotate\(-15\)/,
  );
  await editor
    .getByLabel("Replace image", { exact: false })
    .setInputFiles("public/assets/plot-dimensions-example.png");
  await editor.getByRole("button", { name: "Stage image" }).click();
  await expect(editor.getByLabel("Image path")).toHaveValue(
    /\/api\/public\/media\//,
  );
  await expect(liveFrame.locator("image")).toHaveAttribute(
    "href",
    /\/api\/admin\/media\//,
  );
  await editor.getByLabel("Visible to customers after publication").check();
  await editor
    .getByLabel("Last reviewed", { exact: false })
    .fill(new Date().toISOString());
  await editor
    .getByLabel("Publish after evidence verification", { exact: false })
    .check();
  await editor
    .getByLabel("Reason", { exact: true })
    .fill("Synthetic owner placement review");
  await editor.getByRole("button", { name: "Save content" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Content saved" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stage owner-indicated amenities" })
    .click();
  const project = await (await page.request.get("/api/public/project")).json();
  const garden = project.items.find(
    (item) => item.id === "owner-ref-garden",
  ).published;
  expect(garden.placementPrecision).toBe("approximate");
  expect(garden.visualScale).toBe(1.3);
  expect(garden.visualRotation).toBe(-15);
  expect(garden.source).toBe("Owner-provided screenshot reference");
  await page.goto("/explore?amenity=owner-ref-garden");
  const mapGarden = page.locator('[data-amenity="owner-ref-garden"]');
  await expect(mapGarden.locator("image")).toHaveAttribute(
    "href",
    garden.imageUrl,
  );
  expect(
    Number(await mapGarden.locator("image").getAttribute("width")),
  ).toBeCloseTo(
    ownerAmenityReferences.find((item) => item.id === "owner-ref-garden")
      .mapSize[0] * 1.3,
  );
  await expect(mapGarden.locator("g")).toHaveAttribute(
    "transform",
    /rotate\(-15\)/,
  );
});
