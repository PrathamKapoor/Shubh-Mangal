import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { validateDisposableTarget } from "../scripts/postgres-check.mjs";

// This test creates and drops a database: opt in only with a dedicated server.
// Never use a client, production, shared, or previously protected cluster.
const enabled = process.env.RUN_POSTGRES_SPATIAL_CHECK === "true";
const origin = "http://localhost:5173";
const password = "Synthetic-spatial-test-927156!";
const lockSql = /^\s*select\s+pg_advisory_xact_lock\s*\(\s*19483\s*,\s*11479\s*\)\s*;?\s*$/i;
const footprint = {
  datum: "WGS84",
  source: "Synthetic survey fixture",
  sourceRevision: "fixture-1",
  outer: [[74.908, 24.466], [74.9081, 24.466], [74.9081, 24.4661], [74.908, 24.4661], [74.908, 24.466]],
  holes: [],
  interactions: [
    { type: "road", id: "approach", segment: [[74.90802, 24.466], [74.90802, 24.46605]] },
    { type: "gate", id: "gate", roadId: "approach", point: [74.90802, 24.466] },
  ],
};
const entrance = {
  title: "Synthetic visitor entrance",
  routeAccess: { lat: 10, lon: 20 },
  physicalAnchor: { lat: 11, lon: 21 },
  headingDegrees: 90,
  state: "existing",
  source: "Synthetic reviewed entrance evidence",
  sourceRevision: "synthetic-revision-1",
  verifiedAt: "2026-11-15T10:00:00+05:30",
  customerVisible: true,
  footprint,
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function bounded(promise, label, ms = 8000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label)), ms); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Observe the real transaction query, while holding the winner after it acquires
// the exact two-integer advisory lock. This does not substitute or acquire a lock.
function instrument(db, hooks) {
  return {
    ...db,
    transaction: (fn) => db.transaction((tx) => fn({
      ...tx,
      query: async (sql, args = []) => {
        if (!lockSql.test(sql)) return tx.query(sql, args);
        const pid = (await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        hooks.attempt.resolve(pid);
        const result = await tx.query(sql, args);
        hooks.acquired.resolve(pid);
        if (hooks.hold) await hooks.release.promise;
        return result;
      },
    })),
  };
}

async function contend(setup, first, second, sendFirst, sendSecond) {
  let firstRequest, secondRequest;
  try {
    firstRequest = sendFirst();
    const firstPid = await bounded(Promise.race([
      first.acquired.promise,
      firstRequest.then((response) => { throw Error(`First endpoint completed with ${response.status} without acquiring SELECT pg_advisory_xact_lock(19483,11479)`); }),
    ]), "First endpoint did not acquire the requested two-integer spatial lock");
    secondRequest = sendSecond();
    const secondPid = await bounded(Promise.race([
      second.attempt.promise,
      secondRequest.then((response) => { throw Error(`Second endpoint completed with ${response.status} without attempting the requested spatial lock`); }),
    ]), "Second endpoint did not attempt the requested two-integer spatial lock");
    assert.notEqual(firstPid, secondPid, "requests must use independent PostgreSQL connections");
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      const row = (await setup.query("SELECT $1::int = ANY(pg_blocking_pids($2::int)) AS blocked", [firstPid, secondPid])).rows[0];
      if (row.blocked) { blocked = true; break; }
      await delay(50);
    }
    assert.ok(blocked, "second endpoint must wait for the first transaction's advisory lock");
  } finally {
    first.release.resolve();
    await Promise.allSettled([firstRequest, secondRequest].filter(Boolean));
  }
  return Promise.all([firstRequest, secondRequest]);
}

function contentionHooks(hold) {
  return { attempt: deferred(), acquired: deferred(), release: deferred(), hold };
}

test("PostgreSQL spatial publication serializes both collision orders using the two-integer lock", { skip: !enabled, timeout: 120000 }, async () => {
  const config = validateDisposableTarget(process.env);
  const [{ default: pg }, { default: request }, { openDatabase, migrate }, { createApp }, { createUser }] = await Promise.all([
    import("pg"), import("supertest"), import("../server/db.mjs"), import("../server/app.mjs"), import("../server/auth.mjs"),
  ]);
  const name = `shubh_test_spatial_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^shubh_test_spatial_[a-f0-9]{32}$/);
  const admin = new pg.Client(config);
  admin.on("error", () => {});
  let created = false;
  const pools = [];
  try {
    await admin.connect();
    const version = Number((await admin.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.equal(Math.floor(version / 10000), config.major);
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const url = new URL("postgresql://localhost");
    url.hostname = config.host === "::1" ? "[::1]" : config.host;
    url.port = String(config.port);
    url.username = config.user;
    url.password = config.password;
    url.pathname = `/${name}`;
    url.searchParams.set("sslmode", "disable");
    url.searchParams.set("options", "-c statement_timeout=15000 -c lock_timeout=12000");
    for (let i = 0; i < 3; i++) pools.push(await openDatabase({ url: url.href }));
    const [setup, firstDb, secondDb] = pools;
    await migrate(setup);
    await createUser(setup, { email: "spatial-owner@example.invalid", name: "Synthetic owner", password, role: "owner" });

    for (const winner of ["entrance", "parcel"]) {
      // Independent scenarios use a fresh synthetic login-rate window.
      await setup.query("DELETE FROM rate_limits");
      // Keep previous append-only history intact and remove its public state.
      await setup.query("UPDATE plots SET publication='reviewed' WHERE publication='published'");
      await setup.query("DELETE FROM content WHERE id='visitor-entrance'");
      const plotId = randomUUID();
      const revision = `fixture-${randomUUID()}`;
      await setup.query("INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES($1,$1,'{}')", [revision]);
      await setup.query("INSERT INTO draft_cells(id,revision_id,data) VALUES($1,$1,$2)", [revision, JSON.stringify({ geographicGeometry: { type: "Polygon", coordinates: [footprint.outer] } })]);
      await setup.query("INSERT INTO plots(id,number,block,data,publication,verified_at) VALUES($1,$2,'TEST',$3,'reviewed',now())", [plotId, revision, JSON.stringify({ number: revision, block: "TEST" })]);
      await setup.query("INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,$2,$2)", [plotId, revision]);
      await setup.query("INSERT INTO content(id,kind,draft) VALUES('visitor-entrance','site_access',$1)", [JSON.stringify(entrance)]);

      const first = contentionHooks(true);
      const second = contentionHooks(false);
      const apps = [firstDb, secondDb].map((db, index) => createApp(instrument(db, index ? second : first), { origin, demo: false, production: false, googleMaps: false, logging: false }));
      const clients = [];
      for (const app of apps) {
        const agent = request.agent(app);
        const login = await agent.post("/api/auth/login").set("Origin", origin).send({ email: "spatial-owner@example.invalid", password });
        assert.equal(login.status, 200);
        clients.push({ agent, csrf: login.body.csrf });
      }
      const keys = { entrance: randomUUID(), parcel: randomUUID() };
      const send = (client, type) => {
        const operation = type === "entrance"
          ? client.agent.put("/api/admin/content/visitor-entrance").send({ kind: "site_access", data: entrance, expectedVersion: 1, publish: true, reason: "Synthetic concurrent entrance publication" })
          : client.agent.patch(`/api/admin/plots/${plotId}`).send({ publication: "published", expectedVersion: 1, reason: "Synthetic concurrent parcel publication" });
        return operation.set("Origin", origin).set("X-CSRF-Token", client.csrf).set("Idempotency-Key", keys[type]).then((response) => response);
      };
      const auditBefore = (await setup.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id='visitor-entrance'")).rows[0].n;
      const [won, lost] = await contend(setup, first, second,
        () => send(clients[0], winner),
        () => send(clients[1], winner === "entrance" ? "parcel" : "entrance"));
      assert.equal(won.status, 200, JSON.stringify(won.body));
      assert.equal(lost.status, 422, JSON.stringify(lost.body));
      assert.match(JSON.stringify(lost.body), new RegExp(plotId));
      const stored = (await setup.query("SELECT publication,version FROM plots WHERE id=$1", [plotId])).rows[0];
      const content = (await setup.query("SELECT draft,published,version FROM content WHERE id='visitor-entrance'")).rows[0];
      assert.equal(stored.publication, winner === "parcel" ? "published" : "reviewed");
      assert.equal(stored.version, winner === "parcel" ? 2 : 1);
      assert.deepEqual(content.draft, entrance);
      assert.deepEqual(content.published, winner === "entrance" ? entrance : null);
      assert.equal(content.version, winner === "entrance" ? 2 : 1);
      const parcelAudit = (await setup.query("SELECT action FROM audit_logs WHERE entity_id=$1", [plotId])).rows;
      const entranceAudit = (await setup.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_id='visitor-entrance'")).rows[0].n;
      assert.deepEqual(parcelAudit.map((row) => row.action), winner === "parcel" ? ["plot.update"] : []);
      assert.equal(entranceAudit - auditBefore, winner === "entrance" ? 1 : 0);
      const savedKeys = (await setup.query("SELECT key FROM idempotency WHERE key = ANY($1::text[])", [Object.values(keys)])).rows.map((row) => row.key);
      assert.deepEqual(savedKeys, [keys[winner]]);
      const project = await request(apps[0]).get("/api/public/project");
      const geometry = await request(apps[0]).get("/api/public/geometry");
      assert.equal(project.status, 200);
      assert.equal(geometry.status, 200);
      assert.equal(project.body.siteAccessStatus, winner === "entrance" ? "available" : "unavailable");
      assert.equal(project.body.items.some((item) => item.id === "visitor-entrance"), winner === "entrance");
      assert.equal(geometry.body.features.some((feature) => feature.id === plotId), winner === "parcel");
    }

    // Competing parcel publications must serialize even across revisions.
    await setup.query("UPDATE plots SET publication='reviewed' WHERE publication='published'");
    await setup.query("DELETE FROM content WHERE id='visitor-entrance'");
    for (const winningIndex of [0,1]) {
      await setup.query("DELETE FROM rate_limits");
      await setup.query("UPDATE plots SET publication='reviewed' WHERE publication='published'");
      const ids = [randomUUID(),randomUUID()];
      for (const id of ids) {
        const revision = `parcel-${randomUUID()}`;
        await setup.query("INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES($1,$1,'{}')",[revision]);
        await setup.query("INSERT INTO draft_cells(id,revision_id,data) VALUES($1,$1,$2)",[revision,JSON.stringify({geographicGeometry:{type:"Polygon",coordinates:[footprint.outer]}})]);
        await setup.query("INSERT INTO plots(id,number,block,data,publication,verified_at) VALUES($1,$2,'TEST',$3,'reviewed',now())",[id,id,JSON.stringify({number:id,block:"TEST"})]);
        await setup.query("INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,$2,$2)",[id,revision]);
      }
      const first=contentionHooks(true), second=contentionHooks(false);
      const apps=[firstDb,secondDb].map((db,index)=>createApp(instrument(db,index ? second : first),{origin,demo:false,logging:false}));
      const clients=[];
      for (const app of apps) {
        const agent=request.agent(app);
        const login=await agent.post("/api/auth/login").set("Origin",origin).send({email:"spatial-owner@example.invalid",password});
        assert.equal(login.status,200);
        clients.push({agent,csrf:login.body.csrf});
      }
      const keys=[randomUUID(),randomUUID()], losingIndex=1-winningIndex;
      const send=(client,index)=>client.agent.patch(`/api/admin/plots/${ids[index]}`)
        .set("Origin",origin).set("X-CSRF-Token",client.csrf).set("Idempotency-Key",keys[index])
        .send({publication:"published",expectedVersion:1,reason:"Synthetic competing parcel publication"}).then((response)=>response);
      const [won,lost]=await contend(setup,first,second,()=>send(clients[0],winningIndex),()=>send(clients[1],losingIndex));
      assert.equal(won.status,200,JSON.stringify(won.body));
      assert.equal(lost.status,422,JSON.stringify(lost.body));
      assert.match(JSON.stringify(lost.body),new RegExp(ids[winningIndex]));
      const rows=(await setup.query("SELECT id,publication,version FROM plots WHERE id=ANY($1::uuid[])",[ids])).rows;
      assert.equal(rows.find((row)=>row.id===ids[losingIndex]).publication,"reviewed");
      assert.equal(rows.find((row)=>row.id===ids[losingIndex]).version,1);
      const audits=(await setup.query("SELECT entity_id FROM audit_logs WHERE entity_id=ANY($1::text[])",[ids])).rows;
      assert.deepEqual(audits,[{entity_id:ids[winningIndex]}]);
    }

    // Both drafts are stored before either publication. Their overlapping
    // footprints compete only through the real authenticated content endpoint.
    await setup.query("UPDATE plots SET publication='reviewed' WHERE publication='published'");
    await setup.query("DELETE FROM content WHERE id='visitor-entrance'");
    const [{ planToGeographic }, { default: layout }] = await Promise.all([
      import("../shared/geography.mjs"),
      import("../public/data/layout.json", { with: { type: "json" } }),
    ]);
    const structure = (title, x, y) => {
      const point = ([px, py]) => {
        const { lon, lat } = planToGeographic({ x: px, y: py }, layout);
        return [lon, lat];
      };
      return {
        title,
        footprint: {
          datum: "WGS84",
          outer: [[x, y], [x + 8, y], [x + 8, y + 8], [x, y + 8], [x, y]].map(point),
          holes: [], source: "Synthetic survey", sourceRevision: "fixture-1",
        },
        frame: {
          physicalAnchor: planToGeographic({ x, y }, layout), headingDegrees: 90,
          modelAxes: "right-up-forward", worldAxes: "east-up-south", units: "metres", pivot: [0, 0, 0],
        },
        height: null, model: null, verifiedAt: "2026-11-15T10:00:00Z", customerVisible: true,
      };
    };
    for (const winningIndex of [0, 1]) {
      await setup.query("DELETE FROM rate_limits");
      // Previous structure rows are synthetic and no longer participate;
      // retain their append-only audit history.
      await setup.query("DELETE FROM content WHERE kind='structure'");
      const ids = [`synthetic-building-a-${winningIndex}`, `synthetic-building-b-${winningIndex}`];
      const drafts = [structure("Synthetic building A", 100, 100), structure("Synthetic building B", 104, 104)];
      for (const [index, id] of ids.entries())
        await setup.query("INSERT INTO content(id,kind,draft) VALUES($1,'structure',$2)", [id, JSON.stringify(drafts[index])]);
      const before = (await setup.query("SELECT * FROM content WHERE id = ANY($1::text[]) ORDER BY id", [ids])).rows;
      const first = contentionHooks(true), second = contentionHooks(false);
      const apps = [firstDb, secondDb].map((db, index) => createApp(instrument(db, index ? second : first), { origin, demo: false, production: false, googleMaps: false, logging: false }));
      const clients = [];
      for (const app of apps) {
        const agent = request.agent(app);
        const login = await agent.post("/api/auth/login").set("Origin", origin).send({ email: "spatial-owner@example.invalid", password });
        assert.equal(login.status, 200, JSON.stringify(login.body));
        clients.push({ agent, csrf: login.body.csrf });
      }
      const keys = [randomUUID(), randomUUID()];
      const send = (client, index) => client.agent.put(`/api/admin/content/${ids[index]}`)
        .set("Origin", origin).set("X-CSRF-Token", client.csrf).set("Idempotency-Key", keys[index])
        .send({ kind: "structure", data: drafts[index], expectedVersion: 1, publish: true, reason: "Synthetic competing structure publication" })
        .then((response) => response);
      const losingIndex = 1 - winningIndex;
      const [won, lost] = await contend(setup, first, second,
        () => send(clients[0], winningIndex), () => send(clients[1], losingIndex));
      assert.equal(won.status, 200, JSON.stringify(won.body));
      assert.equal(lost.status, 422, JSON.stringify(lost.body));
      assert.match(JSON.stringify(lost.body), new RegExp(ids[winningIndex]));

      const after = (await setup.query("SELECT * FROM content WHERE id = ANY($1::text[]) ORDER BY id", [ids])).rows;
      const oldLoser = before.find((row) => row.id === ids[losingIndex]);
      const newLoser = after.find((row) => row.id === ids[losingIndex]);
      assert.deepEqual(newLoser, oldLoser, "failed publication must preserve the whole draft row");
      const newWinner = after.find((row) => row.id === ids[winningIndex]);
      assert.equal(newWinner.version, 2);
      assert.deepEqual(newWinner.draft, drafts[winningIndex]);
      assert.deepEqual(newWinner.published, drafts[winningIndex]);
      const audits = (await setup.query("SELECT entity_id,action FROM audit_logs WHERE entity_id = ANY($1::text[])", [ids])).rows;
      assert.deepEqual(audits, [{ entity_id: ids[winningIndex], action: "content.update" }]);
      const savedKeys = (await setup.query("SELECT key FROM idempotency WHERE key = ANY($1::text[])", [keys])).rows;
      assert.deepEqual(savedKeys, [{ key: keys[winningIndex] }]);
      const project = await request(apps[0]).get("/api/public/project");
      assert.equal(project.status, 200);
      const structures = project.body.items.filter((item) => item.kind === "structure");
      assert.deepEqual(structures.map((item) => item.id), [ids[winningIndex]]);
      assert.deepEqual(structures[0].published, {
        title: drafts[winningIndex].title,
        footprint: { outer: drafts[winningIndex].footprint.outer, holes: [] },
        frame: drafts[winningIndex].frame, height: null, model: null,
      });
    }
  } finally {
    for (const pool of pools.reverse()) await pool.close();
    if (created) {
      assert.match(name, /^shubh_test_spatial_[a-f0-9]{32}$/);
      await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await admin.end();
  }
});
