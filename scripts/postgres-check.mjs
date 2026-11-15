// Dedicated opt-in PostgreSQL 16 check; not part of the default Node test glob.
// NOT RUN locally: docker/psql are unavailable in the reviewed environment.
// Database + media pg_dump/pg_restore recovery remains NOT RUN / unresolved.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateDisposableTarget(env) {
  if (env.ALLOW_DISPOSABLE_POSTGRES !== "true" || !env.TEST_DATABASE_URL)
    throw Error("Explicit disposable-test settings required");
  const url = new URL(env.TEST_DATABASE_URL);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.search ||
    url.hash ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^\/shubh_test_[a-z0-9_]+$/.test(url.pathname) ||
    url.pathname.length > 64 ||
    !url.username ||
    !url.password
  )
    throw Error("Unsafe disposable-test target");
  const port = Number(url.port || 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Invalid test port");
  // Pin localhost to a numeric loopback address; reject URL query overrides.
  return {
    host: url.hostname === "[::1]" ? "::1" : "127.0.0.1",
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: false,
    options: "",
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
    lock_timeout: 5000,
    idle_in_transaction_session_timeout: 10000,
    application_name: "shubh-disposable-postgres-check",
  };
}

export async function runPostgresCheck(env = process.env) {
  let config;
  try {
    config = validateDisposableTarget(env);
  } catch {
    console.error(
      "PostgreSQL check rejected: invalid disposable-test configuration.",
    );
    return 1;
  }
  // All dependencies and connections are reached only after the guards above.
  let admin,
    stage = "dependencies",
    failed = false,
    asynchronousError = false;
  const connections = new Set(),
    created = new Set(),
    completed = [];
  const prefix = `shubh_test_run_${randomUUID().replaceAll("-", "")}`;
  const names = new Set([`${prefix}_fresh`, `${prefix}_upgrade`]);
  const safeGeneratedName = (name) =>
    names.has(name) &&
    name !== config.database &&
    /^shubh_test_run_[a-f0-9]{32}_(fresh|upgrade)$/.test(name);
  try {
    const { default: pg } = await import("pg");
    const { default: request } = await import("supertest");
    const { migrate } = await import("../server/db.mjs");
    const { createApp } = await import("../server/app.mjs");
    const { createUser } = await import("../server/auth.mjs");
    const { approveDraft, updatePlot } =
      await import("../server/inventory.mjs");
    const migrations = (
      await readdir(new URL("../server/migrations/", import.meta.url))
    )
      .filter((file) => file.endsWith(".sql"))
      .sort();
    assert.equal(migrations[0], "001_initial.sql");
    const clientFor = (database) => {
      const client = new pg.Client({ ...config, database });
      client.on("error", () => {
        asynchronousError = true;
      });
      return client;
    };
    const connect = async (name) => {
      assert.ok(created.has(name) && safeGeneratedName(name));
      const client = clientFor(name);
      connections.add(client);
      await client.connect();
      const db = {
        query: (sql, values = []) => client.query(sql, values),
        exec: (sql) => client.query(sql),
        close: async () => {
          await client.end();
          connections.delete(client);
        },
        transaction: async (fn) => {
          await client.query("BEGIN");
          try {
            const result = await fn(db);
            await client.query("COMMIT");
            return result;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
        },
        kind: "postgres",
      };
      return db;
    };
    const createDatabase = async (name) => {
      assert.ok(safeGeneratedName(name));
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
      // Never clean up a database unless this invocation successfully created it.
      created.add(name);
      return connect(name);
    };
    const verifyMigrations = async (db) =>
      assert.deepEqual(
        (
          await db.query(
            "SELECT version FROM schema_migrations ORDER BY version",
          )
        ).rows.map((r) => r.version),
        migrations,
      );
    stage = "control-connection";
    admin = clientFor(config.database);
    await admin.connect();
    const version = Number(
      (await admin.query("SHOW server_version_num")).rows[0].server_version_num,
    );
    assert.ok(version >= 160000 && version < 170000);

    stage = "fresh-migrations";
    let db = await createDatabase(`${prefix}_fresh`);
    await migrate(db);
    await migrate(db);
    await verifyMigrations(db);
    completed.push("fresh migrations twice");

    stage = "synthetic-enquiry";
    const origin = "http://127.0.0.1:5189";
    const app = createApp(db, {
      origin,
      demo: false,
      production: false,
      serveStatic: false,
      logging: false,
      googleMaps: false,
      mediaDirectory: join(tmpdir(), prefix + "_unused_media"),
    });
    const enquiry = await request(app)
      .post("/api/enquiries")
      .set("Origin", origin)
      .set("Idempotency-Key", randomUUID())
      .send({
        name: "Synthetic PostgreSQL Buyer",
        phone: "+91 9000000000",
        email: "fixture@example.invalid",
        message: "Synthetic CI fixture only",
        consent: true,
        language: "en",
        plotIds: [],
      })
      .timeout({ response: 10000, deadline: 15000 });
    assert.equal(enquiry.status, 201);
    const enquiryId = enquiry.body.reference;
    assert.match(enquiryId, /^[a-f0-9-]{36}$/);

    stage = "public-geometry";
    const owner = {
      id: await createUser(db, {
        email: "owner@example.invalid",
        name: "Synthetic Owner",
        password: randomUUID() + randomUUID(),
        role: "owner",
      }),
      role: "owner",
    };
    const revision = "synthetic-postgres-revision",
      draft = "synthetic-postgres-cell";
    const geometry = {
      type: "Polygon",
      coordinates: [
        [
          [74.91, 24.47],
          [74.9101, 24.47],
          [74.9101, 24.4701],
          [74.91, 24.4701],
          [74.91, 24.47],
        ],
      ],
    };
    await db.query(
      "INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES($1,$1,$2)",
      [
        revision,
        JSON.stringify({ source: "Synthetic CI fixture; not a survey" }),
      ],
    );
    await db.query(
      "INSERT INTO draft_cells(id,revision_id,data) VALUES($1,$2,$3)",
      [
        draft,
        revision,
        JSON.stringify({ id: draft, edges: [], geographicGeometry: geometry }),
      ],
    );
    let plot = await db.transaction((tx) =>
      approveDraft(tx, owner, draft, {
        number: "SYNTHETIC-1",
        block: "SYNTHETIC",
        sourceDocument: "Synthetic CI fixture only",
        sourceRevision: revision,
        reviewNote: "Synthetic CI evidence; not a survey",
        dimensions: [],
      }),
    );
    const publicGeometry = async () => {
      const response = await request(app)
        .get("/api/public/geometry")
        .timeout({ response: 10000, deadline: 15000 });
      assert.equal(response.status, 200);
      assert.equal(response.body.type, "FeatureCollection");
      return response.body;
    };
    assert.deepEqual((await publicGeometry()).features, []);
    for (const publication of ["reviewed", "published"]) {
      plot = await db.transaction((tx) =>
        updatePlot(tx, owner, plot.id, {
          expectedVersion: plot.version,
          publication,
          reason: "Synthetic PostgreSQL publication check",
        }),
      );
    }
    const published = await publicGeometry();
    assert.equal(published.features.length, 1);
    assert.equal(published.features[0].id, plot.id);
    assert.equal(published.features[0].properties.geometryId, draft);
    assert.deepEqual(published.features[0].geometry, geometry);
    await db.transaction((tx) =>
      updatePlot(tx, owner, plot.id, {
        expectedVersion: plot.version,
        publication: "draft",
        reason: "Synthetic PostgreSQL withdrawal check",
      }),
    );
    const withdrawn = await publicGeometry();
    assert.deepEqual(withdrawn.features, []);
    assert.deepEqual(withdrawn.mappings, []);
    assert.notEqual(withdrawn.snapshot, published.snapshot);
    completed.push("createApp public geometry publish/unpublish");

    stage = "close-reopen-persistence";
    await db.close();
    db = await connect(`${prefix}_fresh`);
    assert.equal(
      (await db.query("SELECT data FROM enquiries WHERE id=$1", [enquiryId]))
        .rows[0].data.name,
      "Synthetic PostgreSQL Buyer",
    );
    await verifyMigrations(db);
    await db.close();
    completed.push("synthetic API enquiry persists across reconnect");

    stage = "historical-001-upgrade";
    const upgrade = await createDatabase(`${prefix}_upgrade`);
    await upgrade.transaction(async (tx) => {
      await tx.exec(
        await readFile(
          new URL("../server/migrations/001_initial.sql", import.meta.url),
          "utf8",
        ),
      );
      await tx.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        "001_initial.sql",
      ]);
    });
    const legacyId = randomUUID(),
      visitId = randomUUID();
    await upgrade.query("INSERT INTO enquiries(id,data) VALUES($1,$2)", [
      legacyId,
      JSON.stringify({ name: "Synthetic historical buyer", consent: true }),
    ]);
    await upgrade.query(
      "INSERT INTO visit_requests(id,enquiry_id,preferred_at,scheduled_at,status) VALUES($1,$2,$3,$3,'confirmed')",
      [visitId, legacyId, "2099-01-01T00:00:00Z"],
    );
    await upgrade.query(
      "INSERT INTO content(id,kind,draft) VALUES('synthetic-legacy','setting',$1)",
      [JSON.stringify({ name: "Synthetic historical setting" })],
    );
    await migrate(upgrade);
    await migrate(upgrade);
    await verifyMigrations(upgrade);
    assert.equal(
      (
        await upgrade.query("SELECT data FROM enquiries WHERE id=$1", [
          legacyId,
        ])
      ).rows[0].data.name,
      "Synthetic historical buyer",
    );
    assert.equal(
      (
        await upgrade.query(
          "SELECT draft FROM content WHERE id='synthetic-legacy'",
        )
      ).rows[0].draft.name,
      "Synthetic historical setting",
    );
    await upgrade.query(
      "UPDATE visit_requests SET status='no_show' WHERE id=$1",
      [visitId],
    );
    assert.equal(
      (
        await upgrade.query("SELECT status FROM visit_requests WHERE id=$1", [
          visitId,
        ])
      ).rows[0].status,
      "no_show",
    );
    await assert.rejects(
      upgrade.query("UPDATE visit_requests SET scheduled_at=NULL WHERE id=$1", [
        visitId,
      ]),
      (error) => error.code === "23514",
    );
    await upgrade.query(
      "INSERT INTO content(id,kind,draft) VALUES('synthetic-presentation','presentation',$1)",
      [JSON.stringify({ placements: [] })],
    );
    await assert.rejects(
      upgrade.exec("TRUNCATE audit_logs"),
      (error) => error.code === "P0001",
    );
    await upgrade.close();
    completed.push(
      "historical 001 to latest preserves records and enables 002/003/004 constraints",
    );
    assert.equal(asynchronousError, false);
  } catch {
    failed = true;
    // Never emit raw pg/assertion errors: they can contain URLs, SQL or row values.
    console.error(JSON.stringify({ result: "failed", stage }));
  } finally {
    let cleanupFailed = false;
    for (const client of connections) {
      try {
        await client.end();
      } catch {
        cleanupFailed = true;
      }
    }
    for (const name of created) {
      try {
        assert.ok(safeGeneratedName(name));
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } catch {
        cleanupFailed = true;
      }
    }
    if (admin) {
      try {
        await admin.end();
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) {
      failed = true;
      console.error(
        JSON.stringify({
          result: "failed",
          stage: "generated-database-cleanup",
        }),
      );
    }
  }
  if (failed) return 1;
  console.info(
    JSON.stringify({
      result: "passed",
      completed,
      cleanup: "generated databases removed",
      unresolved: [
        "Database and synthetic media pg_dump/pg_restore backup/recovery NOT RUN",
      ],
    }),
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await runPostgresCheck();
