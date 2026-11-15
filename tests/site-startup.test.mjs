import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { openDatabase, migrate } from "../server/db.mjs";
import { seed } from "../server/seed.mjs";
import {
  loadSiteSource,
  assertSourceDatabase,
} from "../server/site-source.mjs";
import { createApp } from "../server/app.mjs";
import { pathToGeographicGeometry } from "../shared/geography.mjs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUser } from "../server/auth.mjs";
import { planToGeographic } from "../shared/geography.mjs";

const fixture = "tests/fixtures/second-site/source.json";

test("selected source supplies server project bounds and geometry in the selected projection", async () => {
  const selected = await loadSiteSource(fixture);
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    await seed(db, { source: selected.source });
    await assertSourceDatabase(db, selected);
    const app = createApp(db, {
      logging: false,
      sourceLayout: selected.layout,
      siteConfig: { name: selected.source.name },
    });
    const response = await request(app).get("/api/public/project");
    assert.deepEqual(
      response.body.geographicBounds,
      [8.99, 49.99, 9.01, 50.01],
    );
    assert.equal(response.body.siteConfig.name, "Synthetic Harbour Gardens");
    const plotId = randomUUID();
    await db.query(
      "INSERT INTO plots(id,number,block,data,publication,verified_at) VALUES($1,'S1','Synthetic','{}','published',now())",
      [plotId],
    );
    await db.query(
      "INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,'synthetic-plot-1',$2)",
      [plotId, selected.revision],
    );
    const publicGeometry = await request(app).get("/api/public/geometry");
    assert.equal(publicGeometry.status, 200);
    assert.equal(publicGeometry.body.features.length, 1);
    assert.ok(
      publicGeometry.body.features[0].geometry.coordinates[0].every(
        ([lon, lat]) => lon > 8.99 && lon < 9.01 && lat > 49.99 && lat < 50.01,
      ),
    );
    const polygon = pathToGeographicGeometry(
      selected.layout.plots[0].path,
      selected.layout,
    );
    const ring = polygon.coordinates[0];
    assert.ok(
      ring.every(
        ([lon, lat]) => lon > 8.99 && lon < 9.01 && lat > 49.99 && lat < 50.01,
      ),
    );
    const legacy = await loadSiteSource();
    await assert.rejects(
      assertSourceDatabase(db, legacy),
      /different source bundle/,
    );
    await assert.rejects(
      assertSourceDatabase(db, {
        ...selected,
        revision: "not-the-layout-hash",
      }),
      /layout.*match/i,
    );
  } finally {
    await db.close();
  }
});

test("bad source selection does not silently select the default", async () => {
  await assert.rejects(
    loadSiteSource("tests/fixtures/second-site/missing.json"),
  );
  await assert.rejects(loadSiteSource(""));
  assert.equal(
    (await loadSiteSource()).source.layoutFile,
    "public/data/layout.json",
  );
});

test("historical legacy hashes and unmarked staged revisions remain startable", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    await db.query(
      "INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES ('old-layout','old-layout','{}'), ('revision-old','staged-hash','{}')",
    );
    await assertSourceDatabase(db, await loadSiteSource());
    await assert.rejects(
      assertSourceDatabase(db, await loadSiteSource(fixture)),
      /different source bundle/,
    );
  } finally {
    await db.close();
  }
});

test("alternate startup rejects unseeded and ambiguous unmarked revisions", async () => {
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    const selected = await loadSiteSource(fixture);
    await assert.rejects(assertSourceDatabase(db, selected), /seed/i);
    await seed(db, { source: selected.source });
    await db.query(
      "INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES ('revision-unknown','staged-hash','{}')",
    );
    await assert.rejects(
      assertSourceDatabase(db, selected),
      /different source bundle/,
    );
  } finally {
    await db.close();
  }
});

test("normal startup refuses alternate sources before opening the legacy browser", () => {
  const result = spawnSync(process.execPath, ["server/start.mjs"], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "development",
      SITE_SOURCE_CONFIG: fixture,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Alternate site startup is disabled.*browser layout and assets/i,
  );
  assert.doesNotMatch(result.stdout, /API: http/);
});

test("normal database commands seed the explicitly selected bundle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "site-source-test-"));
  const dbPath = join(directory, "db");
  const env = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: "",
    LOCAL_DB_PATH: dbPath,
    SITE_SOURCE_CONFIG: fixture,
  };
  try {
    for (const action of ["migrate", "seed"]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/database.mjs", action],
        { env, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
    }
    const db = await openDatabase({ url: null, dir: dbPath });
    try {
      await assertSourceDatabase(db, await loadSiteSource(fixture));
      const rows = (await db.query("SELECT id FROM draft_cells")).rows;
      assert.deepEqual(
        rows.map((row) => row.id).sort(),
        ["synthetic-plot-1", "synthetic-plot-2", "synthetic-plot-3", "synthetic-plot-4"],
      );
    } finally {
      await db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("footprint assessment in an injected server uses the selected layout", async () => {
  const selected = await loadSiteSource(fixture);
  const db = await openDatabase({ url: null, dir: ":memory:" });
  try {
    await migrate(db);
    const origin = "http://localhost:5173",
      password = "Synthetic-test-only-927156!";
    await createUser(db, {
      email: "synthetic@example.invalid",
      name: "Test Owner",
      password,
      role: "owner",
    });
    const app = createApp(db, {
      origin,
      logging: false,
      sourceLayout: selected.layout,
      sourceBundle: selected.source.layoutFile,
    });
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "synthetic@example.invalid", password });
    assert.equal(login.status, 200);
    const point = (x, y) => {
      const { lon, lat } = planToGeographic({ x, y }, selected.layout);
      return [lon, lat];
    };
    const access = {
      title: "Synthetic access",
      routeAccess: { lat: 50, lon: 9 },
      physicalAnchor: null,
      headingDegrees: null,
      state: "existing",
      source: "Synthetic evidence",
      sourceRevision: "1",
      verifiedAt: "2026-11-15T10:00:00Z",
      customerVisible: true,
    };
    await db.query(
      "INSERT INTO content(id,kind,draft,published) VALUES('visitor-entrance','site_access',$1,$1)",
      [JSON.stringify(access)],
    );
    const footprint = {
      datum: "WGS84",
      source: "Synthetic survey",
      sourceRevision: "1",
      outer: [
        point(30, 30),
        point(40, 30),
        point(40, 40),
        point(30, 40),
        point(30, 30),
      ],
      holes: [],
      interactions: [],
    };
    const result = await agent
      .put("/api/admin/content/visitor-entrance/footprint")
      .set("Origin", origin)
      .set("X-CSRF-Token", login.body.csrf)
      .set("Idempotency-Key", randomUUID())
      .send({
        footprint,
        expectedVersion: 1,
        reason: "Synthetic footprint staging",
      });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.footprintAssessment.withinBounds, true);
  } finally {
    await db.close();
  }
});
