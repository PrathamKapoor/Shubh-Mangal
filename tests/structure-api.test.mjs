import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate } from "../server/db.mjs";
import { createUser } from "../server/auth.mjs";
import { createApp } from "../server/app.mjs";
import { planToGeographic } from "../shared/geography.mjs";
import * as structureContracts from "../shared/structure.mjs";
import { preparePublicStructure } from "../shared/measured-structure.mjs";
import layout from "../public/data/layout.json" with { type: "json" };

const origin = "http://localhost:5173",
  password = "Synthetic-structure-test-4821!";
let db, app;
const clients = {};
const point = ([x, y]) => {
  const { lon, lat } = planToGeographic({ x, y }, layout);
  return [lon, lat];
};
const shape = (x, y, w = 8, h = 8) =>
  [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ].map(point);
const structure = (x = 100, y = 100) => ({
  title: "Synthetic building",
  footprint: {
    datum: "WGS84",
    outer: shape(x, y),
    holes: [],
    source: "Synthetic survey",
    sourceRevision: "rev-1",
  },
  frame: {
    physicalAnchor: planToGeographic({ x, y }, layout),
    headingDegrees: 90,
    modelAxes: "right-up-forward",
    worldAxes: "east-up-south",
    units: "metres",
    pivot: [0, 0, 0],
  },
  height: null,
  model: null,
  verifiedAt: "2026-11-15T10:00:00Z",
  customerVisible: true,
});
const access = (outer) => ({
  title: "Gate",
  routeAccess: { lat: 24.47, lon: 74.91 },
  physicalAnchor: null,
  headingDegrees: null,
  state: "existing",
  source: "Synthetic access",
  sourceRevision: "1",
  verifiedAt: "2026-11-15T10:00:00Z",
  customerVisible: true,
  footprint: {
    datum: "WGS84",
    outer,
    holes: [],
    interactions: [],
    source: "Synthetic gate",
    sourceRevision: "1",
  },
});
before(async () => {
  db = await openDatabase({ url: null, dir: ":memory:" });
  await migrate(db);
  app = createApp(db, {
    origin,
    demo: false,
    production: false,
    googleMaps: false,
    logging: false,
  });
  for (const role of ["owner", "content_editor"]) {
    const email = `structure-${role}@example.invalid`;
    const id = await createUser(db, { email, name: role, password, role });
    const agent = request.agent(app),
      login = await agent
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email, password });
    assert.equal(login.status, 200);
    clients[role] = { agent, csrf: login.body.csrf, id };
  }
});
beforeEach(async () => {
  await db.exec(
    "DELETE FROM content; DELETE FROM plot_geometry; DELETE FROM plots; DELETE FROM draft_cells; DELETE FROM geometry_revisions",
  );
});
after(async () => {
  await db?.close();
});
const put = (role, id, data, version, publish = false, kind = "structure") =>
  clients[role].agent
    .put(`/api/admin/content/${id}`)
    .set("Origin", origin)
    .set("X-CSRF-Token", clients[role].csrf)
    .set("Idempotency-Key", randomUUID())
    .send({
      kind,
      data,
      expectedVersion: version,
      publish,
      reason: "Synthetic structure review",
    });
const check = (r, status) =>
  assert.equal(r.status, status, JSON.stringify(r.body));
const record = async (id) =>
  (await db.query("SELECT * FROM content WHERE id=$1", [id])).rows[0];
const publicItems = async () =>
  (await request(app).get("/api/public/project")).body.items;
async function insertContent(id, kind, data) {
  await db.query(
    "INSERT INTO content(id,kind,draft,published) VALUES($1,$2,$3,$3)",
    [id, kind, JSON.stringify(data)],
  );
}
async function plot(outer, publication = "published") {
  const id = randomUUID(),
    revision = randomUUID();
  await db.query(
    "INSERT INTO geometry_revisions(id,source_hash,provenance) VALUES($1,'fixture','{}')",
    [revision],
  );
  await db.query(
    "INSERT INTO draft_cells(id,revision_id,data) VALUES($1,$1,$2)",
    [
      revision,
      JSON.stringify({
        geographicGeometry: { type: "Polygon", coordinates: [outer] },
      }),
    ],
  );
  await db.query(
    "INSERT INTO plots(id,number,block,data,publication,verified_at) VALUES($1,$2,'TEST',$3,$4,now())",
    [id, id, JSON.stringify({ number: id, block: "TEST" }), publication],
  );
  await db.query(
    "INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,$2,$2)",
    [id, revision],
  );
  return id;
}

test("draft, authorized saved publication, supersession, audit and public allowlist", async () => {
  const first = structure(),
    changed = {
      ...structure(120, 100),
      title: "Changed",
      height: {
        metres: 4,
        source: "Private measurement",
        sourceRevision: "height-1",
      },
      model: null,
    };
  check(await put("owner", "building", first, 0, true), 422);
  check(await put("content_editor", "building", first, 0), 200);
  check(await put("content_editor", "building", first, 1, true), 403);
  check(
    await put("owner", "building", { ...first, title: "changed" }, 1, true),
    422,
  );
  check(await put("owner", "building", first, 1, true), 200);
  check(await put("content_editor", "building", changed, 2), 200);
  assert.deepEqual((await record("building")).published, first);
  check(await put("owner", "building", structure(-100, -100), 3), 422);
  assert.deepEqual((await record("building")).published, first);
  check(await put("owner", "building", changed, 2, true), 409);
  check(await put("owner", "building", changed, 3, true), 200);
  const items = await publicItems(),
    published = items.find((x) => x.id === "building").published;
  assert.ok(structureContracts.publicStructureSchema);
  assert.deepEqual(published, {
    title: changed.title,
    footprint: { outer: changed.footprint.outer, holes: changed.footprint.holes },
    frame: changed.frame,
    height: { metres: 4 },
    model: null,
  });
  assert.equal(structureContracts.publicStructureSchema.safeParse(published).success, true);
  assert.equal(structureContracts.publicStructureSchema.safeParse({ ...published, footprint: changed.footprint }).success, false);
  assert.equal(structureContracts.publicStructureSchema.safeParse({ ...published, model: { assetId: "fixture" } }).success, false);
  assert.ok(preparePublicStructure(items.find((x) => x.id === "building"), layout));
  assert.deepEqual(published.footprint, {
    outer: changed.footprint.outer,
    holes: [],
  });
  assert.equal(published.height.metres, 4);
  assert.doesNotMatch(
    JSON.stringify(published),
    /Private|Synthetic survey|rev-1/,
  );
  const audits = (
    await db.query(
      "SELECT * FROM audit_logs WHERE entity_id='building' ORDER BY new_value->>'version'",
    )
  ).rows;
  assert.equal(audits.length, 4);
  assert.ok(audits.every((a) => a.action === "content.update"));
  assert.deepEqual((await record("building")).published, changed);
});

test("model metadata may be drafted but cannot be published as an approved binding", async () => {
  const first = structure();
  check(await put("owner", "building", first, 0), 200);
  check(await put("owner", "building", first, 1, true), 200);
  const candidate = { ...first, model: { assetId: "fixture", revision: "v1", rights: "Rights asserted", correspondence: "Correspondence asserted" } };
  check(await put("owner", "building", candidate, 2), 200);
  const saved = await record("building");
  check(await put("owner", "building", candidate, 3, true), 422);
  assert.deepEqual(await record("building"), saved);
  assert.deepEqual(saved.published, first);
  assert.equal((await publicItems()).find((item) => item.id === "building").published.model, null);
});

test("authorized unpublish retains the draft, version checks and audit history", async () => {
  const original = structure(), draft = { ...original, title: "Unpublished changes" };
  check(await put("owner", "building", original, 0), 200);
  check(await put("owner", "building", original, 1, true), 200);
  check(await put("content_editor", "building", draft, 2), 200);
  const before = await record("building");
  const auditBefore = (await db.query("SELECT * FROM audit_logs WHERE entity_id='building' ORDER BY id")).rows;
  const key = randomUUID();
  const send = (role, expectedVersion, retryKey = randomUUID()) => clients[role].agent
    .post("/api/admin/content/building/unpublish")
    .set("Origin", origin).set("X-CSRF-Token", clients[role].csrf)
    .set("Idempotency-Key", retryKey)
    .send({ expectedVersion, reason: "Synthetic owner withdrawal" });
  check(await request(app).post("/api/admin/content/building/unpublish").set("Origin", origin).send({ expectedVersion: 3, reason: "Synthetic owner withdrawal" }), 401);
  check(await clients.owner.agent.post("/api/admin/content/building/unpublish").set("Origin", origin).set("Idempotency-Key", randomUUID()).send({ expectedVersion: 3, reason: "Synthetic owner withdrawal" }), 403);
  check(await send("content_editor", 3), 403);
  check(await send("owner", 2), 409);
  assert.deepEqual(await record("building"), before);
  assert.deepEqual((await db.query("SELECT * FROM audit_logs WHERE entity_id='building' ORDER BY id")).rows, auditBefore);
  const withdrawn = await send("owner", 3, key);
  check(withdrawn, 200);
  assert.equal(withdrawn.body.version, 4);
  assert.equal(withdrawn.body.published, null);
  assert.deepEqual(withdrawn.body.draft, draft);
  assert.equal((await publicItems()).some((item) => item.id === "building"), false);
  const retry = await send("owner", 3, key);
  check(retry, 200);
  assert.deepEqual(retry.body, withdrawn.body);
  const rows = (await db.query("SELECT * FROM audit_logs WHERE entity_id='building' ORDER BY id")).rows;
  assert.equal(rows.length, auditBefore.length + 1);
  const event = rows.find((row) => row.action === "structure.unpublish");
  assert.ok(event);
  assert.equal(event.actor_id, clients.owner.id);
  assert.equal(event.reason, "Synthetic owner withdrawal");
  assert.deepEqual(event.old_value.published, original);
  assert.equal(event.new_value.published, null);
  assert.deepEqual(event.new_value.draft, draft);
  check(await send("owner", 4), 409);
  await insertContent("other-kind", "amenity", { synthetic: true });
  check(await clients.owner.agent.post("/api/admin/content/other-kind/unpublish").set("Origin", origin).set("X-CSRF-Token", clients.owner.csrf).set("Idempotency-Key", randomUUID()).send({ expectedVersion: 1, reason: "Synthetic owner withdrawal" }), 404);
  assert.deepEqual((await record("other-kind")).published, { synthetic: true });
});

test("structure writes require authentication, CSRF and idempotency; hidden or invalid records stay private", async () => {
  const body = {
    kind: "structure",
    data: structure(),
    expectedVersion: 0,
    publish: false,
    reason: "Synthetic structure review",
  };
  check(
    await request(app)
      .put("/api/admin/content/building")
      .set("Origin", origin)
      .send(body),
    401,
  );
  check(
    await clients.owner.agent
      .put("/api/admin/content/building")
      .set("Origin", origin)
      .send(body),
    403,
  );
  const key = randomUUID();
  const send = (value) =>
    clients.owner.agent
      .put("/api/admin/content/building")
      .set("Origin", origin)
      .set("X-CSRF-Token", clients.owner.csrf)
      .set("Idempotency-Key", key)
      .send(value);
  const first = await send(body);
  check(first, 200);
  const again = await send(body);
  check(again, 200);
  assert.deepEqual(again.body, first.body);
  check(
    await send({ ...body, data: { ...body.data, title: "different" } }),
    409,
  );
  check(await put("owner", "building", body.data, 1, true), 200);
  await db.query("UPDATE content SET published=$1 WHERE id='building'", [
    JSON.stringify({ ...body.data, customerVisible: false }),
  ]);
  assert.equal(
    (await publicItems()).some((item) => item.id === "building"),
    false,
  );
  await db.query("UPDATE content SET published=$1 WHERE id='building'", [
    JSON.stringify({ ...body.data, unexpected: "private" }),
  ]);
  assert.equal(
    (await publicItems()).some((item) => item.id === "building"),
    false,
  );
});

test("rejects topology, bounds and published plot, entrance and structure overlaps", async () => {
  const base = structure();
  const invalid = {
    ...base,
    footprint: {
      ...base.footprint,
      outer: [
        point([100, 100]),
        point([110, 110]),
        point([100, 110]),
        point([110, 100]),
        point([100, 100]),
      ],
    },
  };
  check(await put("owner", "building", invalid, 0), 422);
  check(await put("owner", "building", structure(-100, -100), 0), 422);
  await plot(shape(100, 100));
  check(await put("owner", "building", base, 0), 422);
  await db.exec(
    "DELETE FROM plot_geometry; DELETE FROM plots; DELETE FROM draft_cells; DELETE FROM geometry_revisions",
  );
  await insertContent(
    "visitor-entrance",
    "site_access",
    access(shape(100, 100)),
  );
  check(await put("owner", "building", base, 0), 422);
  await db.query(
    "UPDATE content SET published=$1 WHERE id='visitor-entrance'",
    [JSON.stringify({ ...access(shape(150, 150)), footprint: undefined })],
  );
  const legacy = await put("owner", "building", base, 0);
  check(legacy, 200);
  assert.match(JSON.stringify(legacy.body.structureAssessment.warnings), /access.*footprint.*clearance/i);
  const published = await put("owner", "building", base, 1, true);
  check(published, 200);
  assert.match(JSON.stringify(published.body.structureAssessment.warnings), /access.*footprint.*clearance/i);
  await db.exec("DELETE FROM content");
  await insertContent("other-building", "structure", base);
  check(await put("owner", "building", base, 0), 422);
  assert.equal(await record("building"), undefined);
});

test("shared boundaries remain publishable with pending clearance warnings", async () => {
  const base = structure();
  await plot(shape(108, 100));
  let response = await put("owner", "building", base, 0);
  check(response, 200);
  assert.match(JSON.stringify(response.body.structureAssessment.warnings), /contact.*clearance/i);
  response = await put("owner", "building", base, 1, true);
  check(response, 200);
  assert.match(JSON.stringify(response.body.structureAssessment.warnings), /contact.*clearance/i);
  assert.ok((await publicItems()).some((item) => item.id === "building"));
  const adjacent = structure(92, 100);
  response = await put("owner", "adjacent-building", adjacent, 0);
  check(response, 200);
  assert.match(JSON.stringify(response.body.structureAssessment.warnings), /contact.*clearance/i);
  response = await put("owner", "adjacent-building", adjacent, 1, true);
  check(response, 200);
  assert.match(JSON.stringify(response.body.structureAssessment.warnings), /contact.*clearance/i);
});

test("invalid saved geometry and unmapped published plots fail closed without altering published data", async () => {
  const base = structure();
  check(await put("owner", "building", base, 0), 200);
  check(await put("owner", "building", base, 1, true), 200);
  const prior = await record("building");
  const id = randomUUID();
  await db.query(
    "INSERT INTO plots(id,number,block,data,publication,verified_at) VALUES($1,$2,'TEST','{}','published',now())",
    [id, id],
  );
  check(await put("owner", "building", structure(120, 100), 2), 422);
  assert.deepEqual(await record("building"), prior);
  assert.equal(
    (await publicItems()).some((item) => item.id === "building"),
    false,
  );
});

test("publication rechecks current geometry and later plot or gate publication cannot conflict", async () => {
  const base = structure();
  check(await put("owner", "building", base, 0), 200);
  const id = await plot(shape(100, 100));
  check(await put("owner", "building", base, 1, true), 422);
  await db.query("UPDATE plots SET publication='reviewed' WHERE id=$1", [id]);
  check(await put("owner", "building", base, 1, true), 200);
  const response = await clients.owner.agent
    .patch(`/api/admin/plots/${id}`)
    .set("Origin", origin)
    .set("X-CSRF-Token", clients.owner.csrf)
    .set("Idempotency-Key", randomUUID())
    .send({
      publication: "published",
      expectedVersion: 1,
      reason: "Synthetic conflicting publication",
    });
  check(response, 422);
  assert.equal(
    (await db.query("SELECT publication FROM plots WHERE id=$1", [id])).rows[0]
      .publication,
    "reviewed",
  );
  await insertContent(
    "visitor-entrance",
    "site_access",
    access(shape(150, 150)),
  );
  const conflicting = access(shape(100, 100));
  await db.query("UPDATE content SET draft=$1 WHERE id='visitor-entrance'", [
    JSON.stringify(conflicting),
  ]);
  check(
    await put("owner", "visitor-entrance", conflicting, 1, true, "site_access"),
    422,
  );
  assert.deepEqual(
    (await record("visitor-entrance")).published.footprint.outer,
    shape(150, 150),
  );
});
