import test from "node:test";
import assert from "node:assert/strict";
import { contentSchemas } from "../server/content.mjs";
import { readFile, readdir } from "node:fs/promises";
import { openDatabase, migrate } from "../server/db.mjs";

// Synthetic fixtures only; these are not evidence of an entrance location.
const access = {
  title: "Visitor entrance",
  routeAccess: { lat: 24.47, lon: 74.91 },
  physicalAnchor: null,
  headingDegrees: null,
  state: "existing",
  source: "Synthetic reviewed source",
  sourceRevision: "fixture-revision-1",
  verifiedAt: "2026-11-15T10:00:00+05:30",
  customerVisible: true,
};

test("site access schema supports unconfigured drafts and optional physical heading", () => {
  assert.ok(contentSchemas.site_access, "site_access schema is registered");
  assert.deepEqual(contentSchemas.site_access.parse(access), access);
  const { headingDegrees: _, ...withoutHeading } = access;
  assert.equal(
    contentSchemas.site_access.safeParse(withoutHeading).success,
    true,
  );
  assert.equal(
    contentSchemas.site_access.safeParse({
      ...withoutHeading,
      routeAccess: null,
      verifiedAt: null,
      state: "confirmation_pending",
      customerVisible: false,
    }).success,
    true,
  );
  assert.equal(
    contentSchemas.site_access.safeParse({
      ...access,
      physicalAnchor: { lat: 0, lon: 0 },
      headingDegrees: 0,
    }).success,
    true,
  );
  assert.equal(
    contentSchemas.site_access.safeParse({ ...access, headingDegrees: 359.9 })
      .success,
    true,
  );
});

test("site access schema rejects malformed points, unsafe text and invalid evidence", () => {
  assert.ok(contentSchemas.site_access, "site_access schema is registered");
  for (const field of ["routeAccess", "physicalAnchor"]) {
    for (const point of [
      {},
      { lat: 24.47 },
      { lat: null, lon: 74.91 },
      { lat: "24.47", lon: 74.91 },
      { lat: NaN, lon: 74.91 },
      { lat: 24.47, lon: Infinity },
      { lat: 91, lon: 74.91 },
      { lat: 24.47, lon: -181 },
      { lat: 24.47, lng: 74.91 },
      { lat: 24.47, lon: 74.91, extra: true },
    ]) {
      assert.equal(
        contentSchemas.site_access.safeParse({ ...access, [field]: point })
          .success,
        false,
      );
    }
  }
  for (const patch of [
    { title: "" },
    { title: "<script>" },
    { source: "" },
    { source: "<img src=x>" },
    { sourceRevision: " " },
    { sourceRevision: "rev\u0000" },
    { verifiedAt: "2026-02-30T00:00:00Z" },
    { verifiedAt: "yesterday" },
    { headingDegrees: -1 },
    { headingDegrees: 360 },
    { headingDegrees: "90" },
    { state: "reviewed" },
    { customerVisible: "true" },
    { extra: "rejected" },
  ]) {
    assert.equal(
      contentSchemas.site_access.safeParse({ ...access, ...patch }).success,
      false,
    );
  }
  for (const key of [
    "source",
    "sourceRevision",
    "verifiedAt",
    "routeAccess",
    "physicalAnchor",
    "customerVisible",
    "state",
    "title",
  ]) {
    const { [key]: _, ...missing } = access;
    assert.equal(
      contentSchemas.site_access.safeParse(missing).success,
      false,
      key,
    );
  }
});

test("reviewed visitor access uses only the canonical visible published existing record", async () => {
  const { reviewedVisitorAccess } = await import("../shared/site-access.mjs");
  const item = {
    id: "visitor-entrance",
    kind: "site_access",
    published: access,
  };
  assert.deepEqual(reviewedVisitorAccess([item]), access);
  for (const patch of [
    { state: "confirmation_pending" },
    { state: "planned" },
    { state: "in_progress" },
    { customerVisible: false },
    { customerVisible: undefined },
    { verifiedAt: null },
    { verifiedAt: "2026-02-30T00:00:00Z" },
    { source: " " },
    { source: "<script>" },
    { sourceRevision: "" },
    { routeAccess: null },
    { routeAccess: { lat: "24.47", lon: 74.91 } },
    { routeAccess: { lat: 24.47, lon: Infinity } },
    { routeAccess: { lat: 91, lon: 74.91 } },
  ])
    assert.equal(
      reviewedVisitorAccess([{ ...item, published: { ...access, ...patch } }]),
      null,
    );
  for (const items of [
    undefined,
    null,
    {},
    [],
    [{ ...item, id: "other-entrance" }],
    [{ ...item, kind: "amenity" }],
    [{ ...item, published: null, draft: access }],
    [
      {
        id: "project",
        kind: "setting",
        published: { entrance: access.routeAccess, verified: true },
      },
    ],
    [
      {
        id: "draft-entrance",
        kind: "amenity",
        draft: {
          ...access,
          category: "entrance",
          location: access.routeAccess,
        },
      },
    ],
    [null, { kind: "site_access" }],
  ])
    assert.equal(reviewedVisitorAccess(items), null);
  const original = structuredClone(item);
  reviewedVisitorAccess([item]);
  assert.deepEqual(item, original, "source evidence is not changed");
});

test("directions use only the reviewed route destination, never an origin or physical anchor fallback", async () => {
  const { directionsUrl } = await import("../shared/site-access.mjs");
  const url = new URL(
    directionsUrl({
      ...access,
      physicalAnchor: { lat: 10, lon: 20 },
      origin: "private-position",
    }),
  );
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/maps/dir/");
  assert.deepEqual(
    [...url.searchParams],
    [
      ["api", "1"],
      ["destination", "24.47,74.91"],
    ],
  );
  for (const invalid of [
    undefined,
    null,
    {},
    { ...access, routeAccess: null },
    { ...access, routeAccess: { lat: 0, lon: NaN } },
    { ...access, routeAccess: { lat: "0", lon: 0 } },
    { ...access, routeAccess: { lat: -91, lon: 0 } },
  ])
    assert.equal(directionsUrl(invalid), null);
  assert.equal(
    new URL(
      directionsUrl({ routeAccess: { lat: 0, lon: 0 } }),
    ).searchParams.get("destination"),
    "0,0",
  );
});

test("site area search uses the approximate bounds centre and never provides directions", async () => {
  const { siteAreaUrl } = await import("../shared/site-access.mjs");
  const bounds = [74, 24, 76, 26];
  const url = new URL(siteAreaUrl(bounds));
  assert.equal(url.origin, "https://www.google.com");
  assert.equal(url.pathname, "/maps/search/");
  assert.deepEqual(
    [...url.searchParams],
    [
      ["api", "1"],
      ["query", "25,75"],
    ],
  );
  assert.deepEqual(bounds, [74, 24, 76, 26]);
  for (const invalid of [
    null,
    undefined,
    {},
    [],
    [74, 24, 76],
    [74, 24, 76, 26, 0],
    [76, 24, 74, 26],
    [74, 26, 76, 24],
    [74, 24, 74, 26],
    [74, 24, 76, 24],
    [-181, 24, 76, 26],
    [74, -91, 76, 26],
    [74, 24, 181, 26],
    [74, 24, 76, 91],
    [74, 24, NaN, 26],
    [74, 24, 76, Infinity],
    ["74", 24, 76, 26],
  ])
    assert.equal(siteAreaUrl(invalid), null);
});

test("site access migration preserves every old kind and source value without creating entrance records", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    const migrations = new URL("../server/migrations/", import.meta.url);
    for (const file of (await readdir(migrations))
      .filter((f) => f.endsWith(".sql") && f < "005_site_access.sql")
      .sort()) {
      await db.exec(await readFile(new URL(file, migrations), "utf8"));
      await db.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
    }
    for (const kind of [
      "setting",
      "amenity",
      "media",
      "nearby",
      "presentation",
    ]) {
      const data = JSON.stringify({
        source: "  Original source value  ",
        sourceRevision: "original rev",
        entrance: { lat: 1, lon: 2 },
      });
      await db.query(
        "INSERT INTO content(id,kind,draft,published,version) VALUES($1,$2,$3,$3,7)",
        [`old-${kind}`, kind, data],
      );
    }
    const before = (await db.query("SELECT * FROM content ORDER BY id")).rows;
    await migrate(db);
    await migrate(db);
    assert.deepEqual(
      (await db.query("SELECT * FROM content ORDER BY id")).rows,
      before,
    );
    await db.query(
      "INSERT INTO content(id,kind,draft) VALUES('visitor-entrance','site_access',$1)",
      [JSON.stringify({ ...access, routeAccess: null, verifiedAt: null })],
    );
    assert.equal(
      (
        await db.query(
          "SELECT published FROM content WHERE id='visitor-entrance'",
        )
      ).rows[0].published,
      null,
    );
    await assert.rejects(
      db.query(
        "INSERT INTO content(id,kind,draft) VALUES('unsupported','unsupported','{}')",
      ),
      /content_kind_check/,
    );
  } finally {
    await db.close();
  }
});
