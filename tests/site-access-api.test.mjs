import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate } from "../server/db.mjs";
import { createUser } from "../server/auth.mjs";
import { createApp } from "../server/app.mjs";
import sourceLayout from "../public/data/layout.json" with { type: "json" };

const origin = "http://localhost:5173";
const password = "Synthetic-site-access-test-927156!";
const id = "visitor-entrance";
// Synthetic points deliberately do not assert an actual entrance or alignment.
const reviewed = {
  title: "Synthetic visitor entrance",
  routeAccess: { lat: 10, lon: 20 },
  physicalAnchor: { lat: 11, lon: 21 },
  headingDegrees: 90,
  state: "existing",
  source: "Synthetic reviewed entrance evidence",
  sourceRevision: "synthetic-revision-1",
  verifiedAt: "2026-11-15T10:00:00+05:30",
  customerVisible: true,
};
const pending = {
  ...reviewed,
  routeAccess: null,
  physicalAnchor: null,
  headingDegrees: null,
  state: "confirmation_pending",
  verifiedAt: null,
  customerVisible: false,
};
let db, app;
const clients = {};

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
    const email = `site-access-${role}@example.invalid`;
    const userId = await createUser(db, {
      email,
      name: `Synthetic ${role}`,
      password,
      role,
    });
    const agent = request.agent(app);
    const login = await agent
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email, password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    assert.ok(login.body.csrf);
    clients[role] = { agent, csrf: login.body.csrf, id: userId };
  }
});

// Isolate content fixtures without deleting or disabling append-only audit data.
beforeEach(async () => {
  await db.exec("DELETE FROM content");
});
after(async () => {
  await db?.close();
});

function put(
  role,
  data,
  {
    contentId = id,
    kind = "site_access",
    version = 0,
    publish = false,
    reason = "Synthetic visitor access API review",
  } = {},
) {
  return clients[role].agent
    .put(`/api/admin/content/${contentId}`)
    .set("Origin", origin)
    .set("X-CSRF-Token", clients[role].csrf)
    .set("Idempotency-Key", randomUUID())
    .send({ kind, data, expectedVersion: version, publish, reason });
}
function expectStatus(response, status) {
  assert.equal(response.status, status, JSON.stringify(response.body));
}
async function project() {
  const response = await request(app).get("/api/public/project");
  expectStatus(response, 200);
  return response.body;
}
async function record() {
  return (await db.query("SELECT * FROM content WHERE id=$1", [id])).rows[0];
}
async function auditRows() {
  return (
    await db.query("SELECT * FROM audit_logs WHERE entity_id=$1 ORDER BY id", [
      id,
    ])
  ).rows;
}
async function insertPublished(data, contentId = id, kind = "site_access") {
  await db.query(
    "INSERT INTO content(id,kind,draft,published) VALUES($1,$2,$3,$3)",
    [contentId, kind, JSON.stringify(data)],
  );
}

test("empty project exposes only indicative source bounds and creates no entrance evidence", async () => {
  const result = await project();
  assert.deepEqual(result.geographicBounds, sourceLayout.geographicBounds);
  assert.deepEqual(result.items, []);
  assert.deepEqual((await db.query("SELECT * FROM content")).rows, []);
  assert.deepEqual((await db.query("SELECT * FROM draft_cells")).rows, []);
});

test("site access mutations require the authenticated user's CSRF token", async () => {
  const body = {
    kind: "site_access",
    data: reviewed,
    expectedVersion: 0,
    publish: true,
    reason: "Synthetic missing CSRF check",
  };
  const unauthenticated = await request(app)
    .put(`/api/admin/content/${id}`)
    .set("Origin", origin)
    .send(body);
  expectStatus(unauthenticated, 401);
  for (const token of [null, "incorrect-synthetic-csrf"]) {
    const mutation = clients.owner.agent
      .put(`/api/admin/content/${id}`)
      .set("Origin", origin)
      .set("Idempotency-Key", randomUUID());
    if (token) mutation.set("X-CSRF-Token", token);
    expectStatus(await mutation.send(body), 403);
  }
  assert.equal(await record(), undefined);
});

test("content editor can save an unconfigured private site access draft", async () => {
  const saved = await put("content_editor", pending);
  expectStatus(saved, 200);
  assert.equal(saved.body.id, id);
  assert.equal(saved.body.kind, "site_access");
  assert.equal(saved.body.version, 1);
  assert.deepEqual(saved.body.draft, pending);
  assert.equal(saved.body.published, null);
  assert.deepEqual((await record()).draft, pending);
  assert.deepEqual((await project()).items, []);
});

test("content editor cannot publish even a fully reviewed visitor entrance", async () => {
  const beforeAudit = await auditRows();
  expectStatus(await put("content_editor", reviewed, { publish: true }), 403);
  assert.equal(await record(), undefined);
  assert.deepEqual(await auditRows(), beforeAudit);
});

test("site access kind and visitor-entrance ID are reserved in both directions", async () => {
  expectStatus(
    await put("owner", pending, { contentId: "other-entrance" }),
    422,
  );
  expectStatus(
    await put(
      "owner",
      {
        title: "Synthetic amenity",
        description: "Synthetic only",
        state: "planned",
        source: "Synthetic amenity source",
        verifiedAt: null,
      },
      { kind: "amenity" },
    ),
    422,
  );
  assert.deepEqual((await db.query("SELECT * FROM content")).rows, []);
});

test("owner publication rejects incomplete, hidden, planned or malformed access without writes", async () => {
  const beforeAudit = await auditRows();
  for (const patch of [
    { state: "confirmation_pending" },
    { state: "planned" },
    { state: "in_progress" },
    { customerVisible: false },
    { routeAccess: null },
    { verifiedAt: null },
    { verifiedAt: "2026-02-30T00:00:00Z" },
    { source: " " },
    { sourceRevision: " " },
    { routeAccess: { lat: "10", lon: 20 } },
    { routeAccess: { lat: 91, lon: 20 } },
    { routeAccess: { lat: 10 } },
    { physicalAnchor: { lat: 11, lon: 181 } },
  ]) {
    expectStatus(
      await put("owner", { ...reviewed, ...patch }, { publish: true }),
      422,
    );
    assert.equal(await record(), undefined);
  }
  assert.deepEqual(await auditRows(), beforeAudit);
});

test("owner publishes reviewed access with distinct route and physical coordinates", async () => {
  const saved = await put("owner", reviewed, { publish: true });
  expectStatus(saved, 200);
  assert.equal(saved.body.version, 1);
  assert.deepEqual(saved.body.published, reviewed);
  const result = await project();
  assert.deepEqual(result.geographicBounds, sourceLayout.geographicBounds);
  assert.deepEqual(result.items, [
    { id, kind: "site_access", published: reviewed },
  ]);
  assert.deepEqual(result.items[0].published.routeAccess, { lat: 10, lon: 20 });
  assert.deepEqual(result.items[0].published.physicalAnchor, {
    lat: 11,
    lon: 21,
  });
});

test("public project excludes invalid or hidden stored access without altering its evidence", async () => {
  // Bypass the write endpoint to exercise defensive projection of old/corrupt rows.
  await insertPublished(reviewed);
  assert.deepEqual((await project()).items, [
    { id, kind: "site_access", published: reviewed },
  ]);
  for (const patch of [
    { state: "confirmation_pending" },
    { state: "planned" },
    { state: "in_progress" },
    { customerVisible: false },
    { customerVisible: undefined },
    { verifiedAt: null },
    { verifiedAt: "invalid" },
    { source: " " },
    { sourceRevision: "" },
    { routeAccess: null },
    { routeAccess: { lat: 91, lon: 20 } },
    { routeAccess: { lat: "10", lon: 20 } },
  ]) {
    const value = JSON.stringify({ ...reviewed, ...patch });
    await db.query("UPDATE content SET published=$1 WHERE id=$2", [value, id]);
    const beforeRead = await record();
    assert.deepEqual((await project()).items, [], JSON.stringify(patch));
    assert.deepEqual(await record(), beforeRead);
  }
  await db.query("DELETE FROM content WHERE id=$1", [id]);
  await insertPublished(reviewed, "noncanonical-entrance");
  assert.deepEqual((await project()).items, []);
});

test("versioned updates, editor draft edits and explicit unpublish clear public access and retain audit", async () => {
  const priorAudit = await auditRows();
  const changed = {
    ...reviewed,
    sourceRevision: "synthetic-revision-2",
    routeAccess: { lat: 12, lon: 22 },
    physicalAnchor: null,
    headingDegrees: null,
  };
  expectStatus(await put("owner", reviewed, { publish: true }), 200);
  const first = await record();
  const firstAudit = await auditRows();
  expectStatus(await put("owner", changed, { publish: true, version: 0 }), 409);
  assert.deepEqual(await record(), first);
  assert.deepEqual(await auditRows(), firstAudit);
  const updated = await put("owner", changed, { publish: true, version: 1 });
  expectStatus(updated, 200);
  assert.equal(updated.body.version, 2);
  assert.deepEqual((await project()).items, [
    { id, kind: "site_access", published: changed },
  ]);
  const drafted = await put("content_editor", pending, { version: 2 });
  expectStatus(drafted, 200);
  assert.equal(drafted.body.version, 3);
  assert.equal(drafted.body.published, null);
  assert.deepEqual((await project()).items, []);
  const republished = await put("owner", changed, {
    publish: true,
    version: 3,
  });
  expectStatus(republished, 200);
  assert.equal(republished.body.version, 4);
  const unpublished = await put("owner", changed, { version: 4 });
  expectStatus(unpublished, 200);
  assert.equal(unpublished.body.version, 5);
  assert.equal((await record()).published, null);
  assert.deepEqual((await project()).items, []);
  const allAudit = await auditRows();
  assert.deepEqual(
    allAudit.filter((row) => priorAudit.some((old) => old.id === row.id)),
    priorAudit,
  );
  const entries = allAudit
    .filter((row) => !priorAudit.some((old) => old.id === row.id))
    .sort((a, b) => a.new_value.version - b.new_value.version);
  assert.equal(entries.length, 5);
  for (const [index, entry] of entries.entries()) {
    assert.equal(entry.action, "content.update");
    assert.equal(
      entry.actor_id,
      clients[index === 2 ? "content_editor" : "owner"].id,
    );
    assert.equal(entry.reason, "Synthetic visitor access API review");
    assert.equal(entry.new_value.version, index + 1);
    assert.equal(entry.old_value?.version ?? 0, index);
  }
  assert.deepEqual(entries[0].new_value.published, reviewed);
  assert.deepEqual(entries[1].old_value.published, reviewed);
  assert.deepEqual(entries[1].new_value.published, changed);
  assert.equal(entries[2].new_value.published, null);
  assert.deepEqual(entries[4].old_value.published, changed);
  assert.equal(entries[4].new_value.published, null);
  await assert.rejects(
    db.query("UPDATE audit_logs SET reason='changed' WHERE id=$1", [
      entries[0].id,
    ]),
    /append-only/,
  );
});

test("visitor entrance lifecycle preserves original project entrance evidence and never imports it", async () => {
  const legacy = {
    name: "Synthetic original project",
    tagline: "",
    contactPhone: "",
    contactEmail: "",
    entrance: { lat: 1, lon: 2 },
    verified: true,
    source: "  Original synthetic project entrance evidence  ",
  };
  await insertPublished(legacy, "project", "setting");
  const original = (await db.query("SELECT * FROM content WHERE id='project'"))
    .rows[0];
  const originalHistory = (
    await db.query(
      "SELECT * FROM audit_logs WHERE entity_id='project' ORDER BY id",
    )
  ).rows;
  assert.deepEqual((await project()).items, [
    { id: "project", kind: "setting", published: legacy },
  ]);
  assert.equal(await record(), undefined);
  expectStatus(await put("content_editor", pending), 200);
  expectStatus(
    await put("owner", reviewed, { publish: true, version: 1 }),
    200,
  );
  expectStatus(await put("owner", pending, { version: 2 }), 200);
  assert.deepEqual(
    (await db.query("SELECT * FROM content WHERE id='project'")).rows[0],
    original,
  );
  assert.deepEqual(
    (
      await db.query(
        "SELECT * FROM audit_logs WHERE entity_id='project' ORDER BY id",
      )
    ).rows,
    originalHistory,
  );
  assert.deepEqual((await project()).items, [
    { id: "project", kind: "setting", published: legacy },
  ]);
});
