import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { contentSchemas } from "../server/content.mjs";
import { openDatabase, migrate } from "../server/db.mjs";

// Synthetic coordinates and evidence only.
const structure = {
  title: "Synthetic building",
  footprint: {
    datum: "WGS84",
    outer: [
      [74.91, 24.47],
      [74.911, 24.47],
      [74.911, 24.471],
      [74.91, 24.47],
    ],
    holes: [
      [
        [74.9101, 24.47005],
        [74.9102, 24.47005],
        [74.9102, 24.47006],
        [74.9101, 24.47005],
      ],
    ],
    source: "Synthetic survey",
    sourceRevision: "revision-1",
  },
  frame: {
    physicalAnchor: { lon: 74.91, lat: 24.47 },
    headingDegrees: 90,
    modelAxes: "right-up-forward",
    worldAxes: "east-up-south",
    units: "metres",
    pivot: [2, 0, -3],
  },
  height: null,
  model: null,
  verifiedAt: "2026-11-15T10:00:00Z",
  customerVisible: false,
};

test("structure contract preserves exact coordinates and unknown height", () => {
  assert.ok(contentSchemas.structure);
  const input = structuredClone(structure);
  assert.deepEqual(contentSchemas.structure.parse(input), structure);
  assert.deepEqual(input, structure);
  const measured = {
    ...structure,
    height: { metres: 4.5, source: "Synthetic measure", sourceRevision: "h1" },
    model: {
      assetId: "synthetic-building",
      revision: "v1",
      rights: "Synthetic fixture",
      correspondence: "Reviewed against synthetic footprint",
    },
  };
  assert.deepEqual(contentSchemas.structure.parse(measured), measured);
});

test("structure rejects incomplete, unsafe and ambiguous measurements or frames", () => {
  assert.ok(contentSchemas.structure);
  for (const patch of [
    { extra: true },
    { title: "<script>" },
    { verifiedAt: "yesterday" },
    { height: 0 },
    { height: { metres: 0, source: "Survey", sourceRevision: "1" } },
    { height: { metres: 3, source: "", sourceRevision: "1" } },
    { height: { metres: Infinity, source: "Survey", sourceRevision: "1" } },
    {
      model: {
        assetId: "https://example.com/model.glb",
        revision: "1",
        rights: "yes",
        correspondence: "yes",
      },
    },
    {
      model: {
        assetId: "fixture",
        revision: "1",
        rights: "",
        correspondence: "yes",
      },
    },
    { frame: { ...structure.frame, modelAxes: "east-up-south" } },
    { frame: { ...structure.frame, worldAxes: "right-up-forward" } },
    { frame: { ...structure.frame, units: "feet" } },
    { frame: { ...structure.frame, extra: true } },
    { frame: { ...structure.frame, pivot: [0, 0] } },
    { frame: { ...structure.frame, pivot: [0, Infinity, 0] } },
    { frame: { ...structure.frame, headingDegrees: 360 } },
    { frame: { ...structure.frame, physicalAnchor: { lon: 181, lat: 0 } } },
    { footprint: { ...structure.footprint, datum: "UTM" } },
    { footprint: { ...structure.footprint, extra: true } },
    {
      footprint: {
        ...structure.footprint,
        holes: [structure.footprint.holes[0].slice(0, -1)],
      },
    },
    {
      footprint: {
        ...structure.footprint,
        outer: structure.footprint.outer.slice(0, -1),
      },
    },
    {
      footprint: {
        ...structure.footprint,
        outer: [
          [74.91, 24.47],
          [74.911, 24.47],
          [74.911, 24.471],
          [74.91, 24.470001],
        ],
      },
    },
    { footprint: { ...structure.footprint, sourceRevision: "" } },
  ])
    assert.equal(
      contentSchemas.structure.safeParse({ ...structure, ...patch }).success,
      false,
      JSON.stringify(patch),
    );
  for (const key of Object.keys(structure)) {
    const { [key]: omitted, ...rest } = structure;
    assert.equal(contentSchemas.structure.safeParse(rest).success, false, key);
    assert.notEqual(omitted, undefined);
  }
});

test("structure migration preserves legacy rows and permits only the added kind", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    const migrations = new URL("../server/migrations/", import.meta.url);
    for (const file of (await readdir(migrations))
      .filter((f) => f.endsWith(".sql") && f < "006_structure.sql")
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
      "site_access",
    ]) {
      await db.query(
        "INSERT INTO content(id,kind,draft,published,version) VALUES($1,$2,$3,$3,7)",
        [
          `old-${kind}`,
          kind,
          JSON.stringify({
            original: "  unchanged  ",
            geometry: [[1.23456789, 2]],
          }),
        ],
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
      "INSERT INTO content(id,kind,draft) VALUES($1,'structure',$2)",
      ["synthetic-building", JSON.stringify(structure)],
    );
    assert.deepEqual(
      (
        await db.query("SELECT draft,published FROM content WHERE id=$1", [
          "synthetic-building",
        ])
      ).rows[0],
      { draft: structure, published: null },
    );
    await assert.rejects(
      db.query(
        "INSERT INTO content(id,kind,draft) VALUES('bad','unsupported','{}')",
      ),
      /content_kind_check/,
    );
  } finally {
    await db.close();
  }
});
