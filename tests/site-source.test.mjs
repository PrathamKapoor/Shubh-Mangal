import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openDatabase, migrate } from "../server/db.mjs";
import { seed } from "../server/seed.mjs";
import { createSiteSource } from "../shared/site-source.mjs";

const synthetic = {
  name: "Synthetic Harbour Gardens",
  layoutFile: "tests/fixtures/second-site/layout.json",
  assets: {
    schematic: "/synthetic/schematic.svg",
    surveyPlan: null,
    poster: null,
    surveyPdf: null,
    kml: null,
  },
  provenance: {
    source: "Synthetic geometry",
    projection: "UTM 32N",
    pdf: null,
    authority: "Synthetic test only",
  },
  amenities: [],
};

test("source bundles select explicit assets and do not inherit another site's files", async () => {
  const source = createSiteSource(synthetic);
  assert.equal(source.layoutFile, synthetic.layoutFile);
  assert.deepEqual(source.assets, synthetic.assets);
  assert.ok(
    (
      await readFile("tests/fixtures/second-site/schematic.svg", "utf8")
    ).includes("<svg"),
  );
  assert.equal(createSiteSource().layoutFile, "public/data/layout.json");
  assert.equal(
    createSiteSource().assets.schematic,
    "/assets/geographic-layout.svg",
  );
  for (const bad of [
    { ...synthetic, layoutFile: "../public/data/layout.json" },
    { ...synthetic, assets: { schematic: "/synthetic/schematic.svg" } },
    {
      ...synthetic,
      assets: { ...synthetic.assets, poster: "https://example.com/a" },
    },
    { ...synthetic, provenance: {} },
  ])
    assert.throws(() => createSiteSource(bad));
});

test("seed reads the selected source without importing legacy plots, provenance or amenities", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    const source = createSiteSource(synthetic);
    const first = await seed(db, { source });
    assert.equal(first.draftCells, 1);
    assert.deepEqual(await seed(db, { source }), first);
    await assert.rejects(seed(db), /different source bundle/);
    const cells = (await db.query("SELECT id FROM draft_cells")).rows;
    assert.deepEqual(
      cells.map((row) => row.id),
      ["synthetic-plot-1"],
    );
    const revision = (
      await db.query("SELECT provenance FROM geometry_revisions")
    ).rows[0].provenance;
    assert.equal(revision.source, "Synthetic geometry");
    assert.equal(revision.projection, "UTM 32N");
    assert.equal(revision.pdf, null);
    assert.deepEqual(revision.bounds, [8.99, 49.99, 9.01, 50.01]);
    const content = (
      await db.query("SELECT id, draft FROM content ORDER BY id")
    ).rows;
    assert.deepEqual(
      content.map((row) => row.id),
      ["project"],
    );
    assert.equal(content[0].draft.name, synthetic.name);
    assert.equal(
      Number((await db.query("SELECT count(*) FROM plots")).rows[0].count),
      0,
    );
  } finally {
    await db.close();
  }
});

test("an alternate seed cannot be mixed into an existing legacy database", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    await seed(db);
    await assert.rejects(seed(db, { source: createSiteSource(synthetic) }), /different source bundle/);
    assert.equal(Number((await db.query("SELECT count(*) FROM draft_cells WHERE id='synthetic-plot-1'")).rows[0].count), 0);
  } finally {
    await db.close();
  }
});
