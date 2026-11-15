// Dedicated opt-in disposable PostgreSQL check; defaults to major version 16.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function validateDisposableTarget(env) {
  if (Object.keys(env).some((key) => /^PG/i.test(key)))
    throw Error("PostgreSQL environment overrides are not allowed");
  if (env.ALLOW_DISPOSABLE_POSTGRES !== "true" || !env.TEST_DATABASE_URL)
    throw Error("Explicit disposable-test settings required");
  const major =
    env.TEST_POSTGRES_MAJOR === undefined ? "16" : env.TEST_POSTGRES_MAJOR;
  if (major !== "16" && major !== "18")
    throw Error("Unsupported PostgreSQL test major version");
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
    major: Number(major),
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
    if (Object.keys(process.env).some((key) => /^PG/i.test(key)))
      throw Error("PostgreSQL environment overrides are not allowed");
    config = validateDisposableTarget(env);
  } catch {
    console.error(
      "PostgreSQL check rejected: invalid disposable-test configuration.",
    );
    return 1;
  }
  // All dependencies and connections are reached only after the guards above.
  let admin,
    workDir,
    stage = "dependencies",
    failed = false,
    asynchronousError = false;
  const connections = new Set(),
    created = new Set(),
    completed = [];
  const prefix = `shubh_test_run_${randomUUID().replaceAll("-", "")}`;
  const names = new Set([
    `${prefix}_fresh`,
    `${prefix}_upgrade`,
    `${prefix}_restore`,
  ]);
  const safeGeneratedName = (name) =>
    names.has(name) &&
    name !== config.database &&
    /^shubh_test_run_[a-f0-9]{32}_(fresh|upgrade|restore)$/.test(name);
  try {
    const { default: pg } = await import("pg");
    const { default: request } = await import("supertest");
    const { migrate, openDatabase } = await import("../server/db.mjs");
    const { stageImage } = await import("../server/media.mjs");
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
      const url = new URL("postgresql://localhost");
      url.hostname = config.host === "::1" ? "[::1]" : config.host;
      url.port = String(config.port);
      url.username = config.user;
      url.password = config.password;
      url.pathname = `/${name}`;
      url.searchParams.set("sslmode", "disable");
      url.searchParams.set("connect_timeout", "5");
      url.searchParams.set(
        "options",
        "-c statement_timeout=10000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=10000",
      );
      const db = await openDatabase({ url: url.href });
      const close = db.close;
      db.close = async () => {
        await close();
        connections.delete(db);
      };
      connections.add(db);
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
    assert.equal(Math.floor(version / 10000), config.major);

    stage = "fresh-migrations";
    let db = await createDatabase(`${prefix}_fresh`);
    await migrate(db);
    await migrate(db);
    await verifyMigrations(db);
    completed.push("fresh migrations twice");

    stage = "pooled-transaction-rollback";
    const rolledBackId = randomUUID();
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.query("INSERT INTO enquiries(id,data) VALUES($1,$2)", [
          rolledBackId,
          JSON.stringify({ name: "Synthetic rollback" }),
        ]);
        throw Error("synthetic rollback");
      }),
      /synthetic rollback/,
    );
    assert.equal(
      (await db.query("SELECT id FROM enquiries WHERE id=$1", [rolledBackId]))
        .rows.length,
      0,
    );
    completed.push("pooled adapter transaction rollback");

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
    const ownerPassword = randomUUID() + randomUUID();
    const owner = {
      id: await createUser(db, {
        email: "owner@example.invalid",
        name: "Synthetic Owner",
        password: ownerPassword,
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
    plot = await db.transaction((tx) =>
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

    stage = "pooled-concurrent-version-conflict";
    let ready = 0;
    let release;
    const bothReady = new Promise((resolve) => {
      release = resolve;
    });
    const pids = [];
    const contenders = await Promise.allSettled(
      [0, 1].map(() =>
        db.transaction(async (tx) => {
          pids.push(
            (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
          );
          if (++ready === 2) release();
          await bothReady;
          return updatePlot(tx, owner, plot.id, {
            expectedVersion: plot.version,
            publication: "reviewed",
            reason: "Synthetic concurrent review",
          });
        }),
      ),
    );
    assert.equal(new Set(pids).size, 2);
    assert.equal(
      contenders.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const conflict = contenders.find((result) => result.status === "rejected");
    assert.equal(conflict?.reason?.status, 409);
    plot = contenders.find((result) => result.status === "fulfilled").value;
    plot = await db.transaction((tx) =>
      updatePlot(tx, owner, plot.id, {
        expectedVersion: plot.version,
        publication: "published",
        reason: "Synthetic republish for recovery",
      }),
    );
    completed.push("concurrent pooled transactions reject stale version");

    stage = "recovery-fixtures";
    const recoveryVisitId = randomUUID();
    await db.query(
      "INSERT INTO visit_requests(id,enquiry_id,preferred_at,status) VALUES($1,$2,$3,'requested')",
      [recoveryVisitId, enquiryId, "2099-01-01T00:00:00Z"],
    );
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "owner@example.invalid", password: ownerPassword })
      .timeout({ response: 10000, deadline: 15000 });
    assert.equal(login.status, 200);
    assert.equal(login.body.id, owner.id);
    const sessionCookie = login.headers["set-cookie"][0].split(";")[0];
    assert.equal(
      (await request(app).get("/api/auth/session").set("Cookie", sessionCookie))
        .status,
      200,
    );
    const recoverySnapshot = async (database) => ({
      plot: (
        await database.query(
          "SELECT p.id,p.version,p.publication,g.draft_id,g.revision_id FROM plots p JOIN plot_geometry g ON g.plot_id=p.id WHERE p.id=$1",
          [plot.id],
        )
      ).rows[0],
      visit: (
        await database.query(
          "SELECT id,enquiry_id,status,preferred_at FROM visit_requests WHERE id=$1",
          [recoveryVisitId],
        )
      ).rows[0],
      audit: (
        await database.query(
          "SELECT id,actor_id,action,entity_id,reason FROM audit_logs WHERE entity_id=$1 ORDER BY id",
          [plot.id],
        )
      ).rows,
    });
    const beforeBackup = await recoverySnapshot(db);
    assert.equal(beforeBackup.plot.publication, "published");
    assert.equal(beforeBackup.plot.draft_id, draft);
    assert.equal(beforeBackup.plot.revision_id, revision);
    assert.equal(beforeBackup.visit.enquiry_id, enquiryId);
    assert.ok(
      beforeBackup.audit.some(
        (row) => row.action === "plot.update" && row.actor_id === owner.id,
      ),
    );

    stage = "synthetic-media-fixture";
    workDir = await mkdtemp(join(tmpdir(), "shubh-postgres-check-"));
    const mediaDir = join(workDir, "media");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a9sAAAAASUVORK5CYII=",
      "base64",
    );
    const visibleImage = await stageImage(mediaDir, png, "image/png");
    const hiddenImage = await stageImage(
      mediaDir,
      Buffer.concat([png, Buffer.from("hidden")]),
      "image/png",
    );
    await db.query(
      "INSERT INTO content(id,kind,draft,published) VALUES($1,'media',$2,$2)",
      ["synthetic-recovery-media", JSON.stringify({ url: visibleImage.url })],
    );

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

    stage = "database-media-recovery";
    const restored = await createDatabase(`${prefix}_restore`);
    const archive = join(workDir, "synthetic.dump");
    const commandEnv = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)),
    );
    commandEnv.PGPASSWORD = config.password;
    const args = [
      "--host",
      config.host,
      "--port",
      String(config.port),
      "--username",
      config.user,
    ];
    const runTool = (tool, toolArgs) =>
      execFileAsync(tool, toolArgs, {
        env: commandEnv,
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      });
    await runTool("pg_dump", [
      ...args,
      "--format=custom",
      "--file",
      archive,
      "--dbname",
      `${prefix}_fresh`,
    ]);
    await cp(mediaDir, join(workDir, "media-backup"), { recursive: true });
    await runTool("pg_restore", [
      ...args,
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "--dbname",
      `${prefix}_restore`,
      archive,
    ]);
    const restoredMedia = join(workDir, "media-restored");
    await cp(join(workDir, "media-backup"), restoredMedia, { recursive: true });
    await verifyMigrations(restored);
    assert.equal(
      (
        await restored.query("SELECT data FROM enquiries WHERE id=$1", [
          enquiryId,
        ])
      ).rows[0].data.name,
      "Synthetic PostgreSQL Buyer",
    );
    assert.equal(
      (
        await restored.query("SELECT id FROM enquiries WHERE id=$1", [
          rolledBackId,
        ])
      ).rows.length,
      0,
    );
    const restoredApp = createApp(restored, {
      origin,
      demo: false,
      production: false,
      serveStatic: false,
      logging: false,
      googleMaps: false,
      mediaDirectory: restoredMedia,
    });
    assert.deepEqual(await recoverySnapshot(restored), beforeBackup);
    const restoredGeometry = await request(restoredApp)
      .get("/api/public/geometry")
      .timeout({ response: 10000, deadline: 15000 });
    assert.equal(restoredGeometry.status, 200);
    assert.equal(restoredGeometry.body.features.length, 1);
    assert.equal(restoredGeometry.body.features[0].id, plot.id);
    assert.equal(
      restoredGeometry.body.features[0].properties.geometryId,
      draft,
    );
    assert.deepEqual(restoredGeometry.body.features[0].geometry, geometry);
    const restoredSession = await request(restoredApp)
      .get("/api/auth/session")
      .set("Cookie", sessionCookie)
      .timeout({ response: 10000, deadline: 15000 });
    assert.equal(restoredSession.status, 200);
    assert.equal(restoredSession.body.id, owner.id);
    assert.equal(restoredSession.body.role, "owner");
    const restoredLogin = await request(restoredApp)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "owner@example.invalid", password: ownerPassword })
      .timeout({ response: 10000, deadline: 15000 });
    assert.equal(restoredLogin.status, 200);
    assert.equal(restoredLogin.body.id, owner.id);
    const restoredImage = await request(restoredApp)
      .get(visibleImage.url)
      .timeout({ response: 10000, deadline: 15000 });
    assert.equal(restoredImage.status, 200);
    assert.deepEqual(restoredImage.body, png);
    assert.equal(
      (
        await request(restoredApp)
          .get(hiddenImage.url)
          .timeout({ response: 10000, deadline: 15000 })
      ).status,
      404,
    );
    await restored.close();
    const sourceAfterRestore = await connect(`${prefix}_fresh`);
    assert.deepEqual(await recoverySnapshot(sourceAfterRestore), beforeBackup);
    assert.equal(
      (
        await request(
          createApp(sourceAfterRestore, {
            origin,
            demo: false,
            production: false,
            serveStatic: false,
            logging: false,
            googleMaps: false,
            mediaDirectory: mediaDir,
          }),
        )
          .get("/api/auth/session")
          .set("Cookie", sessionCookie)
      ).status,
      200,
    );
    await sourceAfterRestore.close();
    completed.push("pg_dump/pg_restore and synthetic media recovery");

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
        await client.close();
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
    if (workDir) {
      try {
        await rm(workDir, { recursive: true, force: true });
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
      cleanup: "generated databases and temporary files removed",
    }),
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  process.exitCode = await runPostgresCheck();
