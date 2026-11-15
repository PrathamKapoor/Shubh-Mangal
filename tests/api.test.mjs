import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, migrate } from "../server/db.mjs";
import { seed } from "../server/seed.mjs";
import { createUser } from "../server/auth.mjs";
import { createApp } from "../server/app.mjs";
import { planToGeographic } from "../server/geometry.mjs";
import { ownerAmenityReferences } from "../shared/owner-amenity-references.mjs";
const origin = "http://localhost:5173",
  password = "Synthetic-test-only-927156!";
let db,
  app,
  clients = {},
  approved,
  visitRef,
  mediaDirectory;
const draft = "plot-1-b26-cell-26";
const evidence = {
  number: "TEST-B26",
  block: "TEST",
  phase: "Synthetic phase",
  corner: true,
  parkFacing: false,
  sourceDocument: "SYNTHETIC TEST EVIDENCE — NOT A SURVEY",
  sourceRevision: "test-1",
  reviewNote: "Synthetic test fixture reviewed for integration testing",
  areaSqM: 100,
  areaSourceText: "100 m²",
  dimensions: [
    { name: "Side one", metres: 10, sourceText: "10 m", edgeIndex: 0 },
  ],
};
const contact = {
  name: "Synthetic Buyer",
  phone: "+91 9000000000",
  email: "test@example.invalid",
  message: "Automated test only",
  consent: true,
  language: "en",
  plotIds: [draft],
};
async function change(role, path, body, method = "post", key = randomUUID()) {
  return clients[role].agent[method](path)
    .set("Origin", origin)
    .set("X-CSRF-Token", clients[role].csrf)
    .set("Idempotency-Key", key)
    .send(body);
}
before(async () => {
  db = await openDatabase({ url: null, dir: ":memory:" });
  await migrate(db);
  await migrate(db);
  await seed(db);
  await seed(db);
  mediaDirectory = await mkdtemp(join(tmpdir(), "shubh-media-test-"));
  app = createApp(db, { origin, logging: false, demo: true, mediaDirectory });
  for (const role of [
    "owner",
    "administrator",
    "sales",
    "reviewer",
    "viewer",
    "content_editor",
  ]) {
    await createUser(db, {
      name: `Test ${role}`,
      email: `${role}@example.invalid`,
      password,
      role,
    });
    const agent = request.agent(app);
    const r = await agent
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: `${role}@example.invalid`, password });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    clients[role] = { agent, csrf: r.body.csrf };
  }
});
after(async () => {
  await db.close();
  await rm(mediaDirectory, { recursive: true, force: true });
});
test("seed is idempotent and never publishes an inventory", async () => {
  assert.equal(
    Number((await db.query("SELECT count(*) FROM draft_cells")).rows[0].count),
    556,
  );
  const r = await request(app).get("/api/public/plots");
  assert.deepEqual(r.body.plots, []);
  assert.equal(r.headers["cache-control"], "no-store");
});
test("public mutations, foreign origins and missing CSRF are rejected", async () => {
  assert.equal((await request(app).get("/api/admin/review")).status, 401);
  assert.equal(
    (
      await request(app)
        .post("/api/admin/reconcile")
        .set("Origin", origin)
        .send({})
    ).status,
    401,
  );
  assert.equal(
    (
      await clients.owner.agent
        .post("/api/admin/reconcile")
        .set("Origin", "https://foreign.invalid")
        .send({})
    ).status,
    403,
  );
  assert.equal(
    (
      await clients.owner.agent
        .post("/api/admin/reconcile")
        .set("Origin", origin)
        .send({})
    ).status,
    403,
  );
});
test("RBAC denies sales publication and reviewer private leads", async () => {
  assert.equal(
    (await clients.reviewer.agent.get("/api/admin/enquiries")).status,
    403,
  );
  assert.equal(
    (await clients.viewer.agent.get("/api/admin/enquiries")).status,
    403,
  );
  assert.equal(
    (
      await change("sales", "/api/admin/reconcile", {
        draftId: draft,
        data: evidence,
      })
    ).status,
    403,
  );
});
test("server validation and spam protection reject invalid forms", async () => {
  for (const patch of [
    { consent: false },
    { phone: "12" },
    { website: "spam.invalid" },
  ]) {
    const r = await request(app)
      .post("/api/enquiries")
      .set("Origin", origin)
      .set("Idempotency-Key", randomUUID())
      .send({ ...contact, ...patch });
    assert.equal(r.status, 422);
  }
});
test("enquiry persistence and concurrent retry deduplication return one reference", async () => {
  const key = randomUUID();
  const send = () =>
    request(app)
      .post("/api/enquiries")
      .set("Origin", origin)
      .set("Idempotency-Key", key)
      .send(contact);
  const [a, b] = await Promise.all([send(), send()]);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.reference, b.body.reference);
  assert.equal(
    Number((await db.query("SELECT count(*) FROM enquiries")).rows[0].count),
    1,
  );
  const conflict = await request(app)
    .post("/api/enquiries")
    .set("Origin", origin)
    .set("Idempotency-Key", key)
    .send({ ...contact, name: "Different Person" });
  assert.equal(conflict.status, 409);
  const privateRows = await clients.sales.agent.get("/api/admin/enquiries");
  assert.equal(privateRows.body.enquiries[0].data.name, contact.name);
  assert.ok(
    !JSON.stringify(
      (await request(app).get("/api/public/plots")).body,
    ).includes(contact.phone),
  );
});
test("visit request starts requested and validates future IST date", async () => {
  const r = await request(app)
    .post("/api/visit-requests")
    .set("Origin", origin)
    .set("Idempotency-Key", randomUUID())
    .send({
      ...contact,
      preferredAt: new Date(Date.now() + 86400000).toISOString(),
    });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.status, "requested");
  visitRef = r.body.visitId;
  const past = await request(app)
    .post("/api/visit-requests")
    .set("Origin", origin)
    .set("Idempotency-Key", randomUUID())
    .send({ ...contact, preferredAt: "2020-01-01T10:00:00+05:30" });
  assert.equal(past.status, 422);
});
test("reconciliation creates an immutable UUID draft and records source mapping", async () => {
  const r = await change("reviewer", "/api/admin/reconcile", {
    draftId: draft,
    data: evidence,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  approved = r.body;
  assert.match(approved.id, /^[a-f\d-]{36}$/);
  assert.equal(approved.publication, "draft");
  assert.equal(approved.status, "unverified");
  assert.equal(
    (await request(app).get(`/api/public/plots/${approved.id}`)).status,
    404,
  );
});
test("publication and verified status gates require review first", async () => {
  const pub = await change(
    "owner",
    `/api/admin/plots/${approved.id}`,
    {
      expectedVersion: 1,
      publication: "published",
      reason: "Synthetic publication test",
    },
    "patch",
  );
  assert.equal(pub.status, 422);
  const status = await change(
    "sales",
    `/api/admin/plots/${approved.id}`,
    {
      expectedVersion: 1,
      status: "available",
      reason: "Synthetic availability test",
    },
    "patch",
  );
  assert.equal(status.status, 422);
  const reviewed = await change(
    "reviewer",
    `/api/admin/plots/${approved.id}`,
    {
      expectedVersion: 1,
      publication: "reviewed",
      reason: "Synthetic owner source review",
    },
    "patch",
  );
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  approved = reviewed.body;
});
test("concurrent inventory writes yield exactly one conflict and preserve audit", async () => {
  const body = {
    expectedVersion: approved.version,
    reason: "Synthetic concurrency test",
  };
  const rs = await Promise.all(
    ["available", "sold"].map((status) =>
      change(
        "sales",
        `/api/admin/plots/${approved.id}`,
        { ...body, status },
        "patch",
      ),
    ),
  );
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  approved = rs.find((r) => r.status === 200).body;
  assert.equal(
    Number(
      (
        await db.query(
          "SELECT count(*) FROM inventory_status_history WHERE plot_id=$1",
          [approved.id],
        )
      ).rows[0].count,
    ),
    1,
  );
});
test("only owner/admin publish reviewed records; public API projects fields safely", async () => {
  const body = {
    expectedVersion: approved.version,
    publication: "published",
    reason: "Synthetic reviewed publication test",
  };
  assert.equal(
    (await change("sales", `/api/admin/plots/${approved.id}`, body, "patch"))
      .status,
    403,
  );
  const r = await change(
    "owner",
    `/api/admin/plots/${approved.id}`,
    body,
    "patch",
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  approved = r.body;
  const pub = await request(app).get(`/api/public/plots/${approved.id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.id, approved.id);
  assert.ok(pub.body.statusUpdatedAt);
  assert.equal(pub.body.geometryId, draft);
  assert.equal(pub.body.approved.areaSqM, 100);
  assert.equal(pub.body.approved.corner, true);
  assert.equal(pub.body.priceINR, null);
  assert.equal(pub.body.approved.reviewNote, undefined);
  assert.equal(pub.body.verified_by, undefined);
  const filtered = await request(app).get("/api/public/plots").query({
    q: "test - b26",
    block: "TEST",
    status: approved.status,
    minArea: 99,
    maxArea: 101,
    limit: 1,
  });
  assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.plots[0].id, approved.id);
  assert.equal(
    (
      await request(app)
        .get("/api/public/plots")
        .query({ phase: "Synthetic phase", corner: "yes" })
    ).body.total,
    1,
  );
  assert.equal(
    (await request(app).get("/api/public/plots").query({ corner: "no" })).body
      .total,
    0,
  );
  const hiddenPrice = await request(app)
    .get("/api/public/plots")
    .query({ maxPrice: 99999999 });
  assert.equal(hiddenPrice.body.total, 0);
  const beyond = await request(app)
    .get("/api/public/plots")
    .query({ limit: 1, offset: 1 });
  assert.deepEqual(beyond.body.plots, []);
  assert.equal(
    (await request(app).get("/api/public/plots?status=unknown")).status,
    422,
  );
});
test("presentation placements retain explicit identity and separate source data", async () => {
  const path = "/api/admin/content/illustrated-layout";
  const placement = {
    plotId: approved.id,
    geometryId: draft,
    dx: 3,
    dy: 0,
    scale: 0.85,
    rotation: 0,
  };
  const data = {
    source: "Synthetic illustrative review",
    verifiedAt: new Date().toISOString(),
    placements: [placement],
  };
  const body = {
    kind: "presentation",
    data,
    expectedVersion: 0,
    publish: false,
    reason: "Synthetic layout review",
  };
  assert.equal((await change("viewer", path, body, "put")).status, 403);
  assert.equal(
    (await change("owner", path, { ...body, publish: true }, "put")).status,
    422,
  );
  assert.equal(
    (
      await change(
        "content_editor",
        path,
        {
          ...body,
          data: {
            ...data,
            placements: [{ ...placement, geometryId: "other" }],
          },
        },
        "put",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await change(
        "content_editor",
        path,
        {
          ...body,
          data: { ...data, placements: [{ ...placement, dx: 101, scale: 1 }] },
        },
        "put",
      )
    ).status,
    422,
  );
  const before = (await request(app).get(`/api/public/plots/${approved.id}`))
    .body;
  const key = randomUUID();
  const saved = await change("content_editor", path, body, "put", key);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(
    (await change("content_editor", path, body, "put", key)).body,
    saved.body,
  );
  assert.equal(
    (await request(app).get("/api/public/project")).body.items.some(
      (item) => item.id === "illustrated-layout",
    ),
    false,
  );
  assert.equal(
    (
      await change(
        "content_editor",
        path,
        { ...body, expectedVersion: 1, publish: true },
        "put",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await change(
        "owner",
        path,
        {
          ...body,
          expectedVersion: 1,
          publish: true,
          data: { ...data, source: "Unsaved changed description" },
        },
        "put",
      )
    ).status,
    422,
  );
  const published = await change(
    "owner",
    path,
    { ...body, expectedVersion: 1, publish: true },
    "put",
  );
  assert.equal(published.status, 200, JSON.stringify(published.body));
  let publicLayout = (
    await request(app).get("/api/public/project")
  ).body.items.find((item) => item.id === "illustrated-layout");
  assert.deepEqual(publicLayout.published.placements, [placement]);
  const revised = await change(
    "content_editor",
    path,
    {
      ...body,
      expectedVersion: 2,
      data: { ...data, placements: [{ ...placement, scale: 0.8 }] },
    },
    "put",
  );
  assert.equal(revised.status, 200, JSON.stringify(revised.body));
  publicLayout = (
    await request(app).get("/api/public/project")
  ).body.items.find((item) => item.id === "illustrated-layout");
  assert.equal(publicLayout.published.placements[0].scale, 0.85);
  const after = (await request(app).get(`/api/public/plots/${approved.id}`))
    .body;
  assert.equal(after.geometryId, before.geometryId);
  assert.equal(after.path, before.path);
  assert.deepEqual(after.approved.dimensions, before.approved.dimensions);
  assert.equal(after.approved.areaSqM, before.approved.areaSqM);
  assert.equal(after.status, before.status);
  const history = await db.query(
    "SELECT action FROM audit_logs WHERE entity_id=$1",
    ["illustrated-layout"],
  );
  assert.equal(
    history.rows.filter((row) => row.action === "content.update").length,
    3,
  );
});
test("inventory CSV requires current approved IDs, commits atomically and retries idempotently", async () => {
  const created = await change("reviewer", "/api/admin/reconcile", {
    draftId: "plot-1-b3-cell-3",
    data: { ...evidence, number: "TEST-CSV-UPDATE" },
  });
  assert.equal(created.status, 201);
  const reviewed = await change(
    "reviewer",
    `/api/admin/plots/${created.body.id}`,
    {
      expectedVersion: created.body.version,
      publication: "reviewed",
      reason: "Synthetic CSV identity review",
    },
    "patch",
  );
  assert.equal(reviewed.status, 200);
  const header =
    "approvedPlotId,expectedVersion,status,priceINR,priceVisible,reason\n";
  const csv = (version) =>
    header +
    `${approved.id},${approved.version},reserved,,,Synthetic batch status review\n${created.body.id},${version},available,,,Synthetic batch status review\n`;
  assert.equal(
    (await request(app).get("/api/admin/inventory-imports/template")).status,
    401,
  );
  assert.equal(
    (
      await change("reviewer", "/api/admin/inventory-imports/preview", {
        csv: csv(reviewed.body.version),
      })
    ).status,
    403,
  );
  assert.match(
    (await clients.sales.agent.get("/api/admin/inventory-imports/template"))
      .text,
    new RegExp(approved.id),
  );
  const preview = await change(
    "sales",
    "/api/admin/inventory-imports/preview",
    { csv: csv(reviewed.body.version) },
  );
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.errors.length, 0);
  const changed = await change(
    "sales",
    `/api/admin/plots/${created.body.id}`,
    {
      expectedVersion: reviewed.body.version,
      priceINR: 12345,
      reason: "Synthetic intervening price edit",
    },
    "patch",
  );
  assert.equal(changed.status, 200);
  const conflict = await change(
    "sales",
    "/api/admin/inventory-imports/commit",
    { previewId: preview.body.id },
  );
  assert.equal(conflict.status, 409);
  const unchanged = (
    await db.query("SELECT version,status FROM plots WHERE id=$1", [
      approved.id,
    ])
  ).rows[0];
  assert.equal(unchanged.version, approved.version);
  assert.equal(unchanged.status, approved.status);
  const retryPreview = await change(
    "sales",
    "/api/admin/inventory-imports/preview",
    { csv: csv(changed.body.version) },
  );
  const key = randomUUID();
  const committed = await change(
    "sales",
    "/api/admin/inventory-imports/commit",
    { previewId: retryPreview.body.id },
    "post",
    key,
  );
  const retry = await change(
    "sales",
    "/api/admin/inventory-imports/commit",
    { previewId: retryPreview.body.id },
    "post",
    key,
  );
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  assert.deepEqual(committed.body, retry.body);
  assert.equal(committed.body.updated, 2);
  approved = (
    await clients.sales.agent.get("/api/admin/plots")
  ).body.plots.find((p) => p.id === approved.id);
  assert.equal(approved.status, "reserved");
  const invalid = await change(
    "sales",
    "/api/admin/inventory-imports/preview",
    { csv: header + `${approved.id},1,available,,,Synthetic stale row test\n` },
  );
  assert.equal(invalid.body.errors[0].row, 2);
});
test("editing evidence unpublishes and increments version without changing approved ID", async () => {
  const r = await change(
    "reviewer",
    `/api/admin/plots/${approved.id}`,
    {
      expectedVersion: approved.version,
      data: { ...evidence, number: "TEST-RENAMED" },
      reason: "Synthetic evidence correction",
    },
    "patch",
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.id, approved.id);
  assert.equal(r.body.publication, "draft");
  approved = r.body;
  assert.equal(
    (await request(app).get(`/api/public/plots/${approved.id}`)).status,
    404,
  );
  const publicLayout = (
    await request(app).get("/api/public/project")
  ).body.items.find((item) => item.id === "illustrated-layout");
  assert.deepEqual(publicLayout.published.placements, []);
});
test("audit/status history cannot be edited or deleted", async () => {
  for (const sql of [
    "DELETE FROM audit_logs",
    "UPDATE audit_logs SET reason='erase'",
    "DELETE FROM inventory_status_history",
    "DELETE FROM plot_verifications",
    "TRUNCATE audit_logs",
  ])
    await assert.rejects(db.query(sql), /append-only/);
});
test("authorised lead and audit pagination keeps visit context and hides staff credentials", async () => {
  const first = await clients.sales.agent.get(
    "/api/admin/enquiries?limit=1&offset=0",
  );
  const next = await clients.sales.agent.get(
    "/api/admin/enquiries?limit=1&offset=1",
  );
  assert.equal(first.status, 200);
  assert.ok(first.body.enquiriesTotal >= 2);
  assert.notEqual(first.body.enquiries[0].id, next.body.enquiries[0].id);
  assert.ok(first.body.visits[0].enquiry_data.name);
  assert.ok(first.body.staff.some((person) => person.name === "Test sales"));
  assert.ok(
    first.body.staff.every((person) => !person.email && !person.password_hash),
  );
  const a = await clients.owner.agent.get(
    `/api/admin/audit?limit=1&offset=0&entity=${approved.id}`,
  );
  const b = await clients.owner.agent.get(
    `/api/admin/audit?limit=1&offset=1&entity=${approved.id}`,
  );
  assert.ok(a.body.total >= 2);
  assert.notEqual(a.body.events[0].id, b.body.events[0].id);
  assert.equal(
    (await clients.reviewer.agent.get("/api/admin/enquiries?limit=1")).status,
    403,
  );
});
test("visit transitions are explicit and version-protected", async () => {
  const base = {
    expectedVersion: 1,
    reason: "Synthetic visit test",
    scheduledAt: null,
  };
  assert.equal(
    (
      await change(
        "sales",
        `/api/admin/visits/${visitRef}`,
        { ...base, status: "completed" },
        "patch",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await change(
        "sales",
        `/api/admin/visits/${visitRef}`,
        { ...base, status: "confirmed" },
        "patch",
      )
    ).status,
    422,
  );
  const confirmed = await change(
    "sales",
    `/api/admin/visits/${visitRef}`,
    {
      ...base,
      status: "confirmed",
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
    },
    "patch",
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, "confirmed");
  assert.equal(
    (
      await change(
        "sales",
        `/api/admin/visits/${visitRef}`,
        { ...base, status: "cancelled" },
        "patch",
      )
    ).status,
    409,
  );
  const early = await change(
    "sales",
    `/api/admin/visits/${visitRef}`,
    {
      expectedVersion: 2,
      status: "no_show",
      scheduledAt: confirmed.body.scheduled_at,
      reason: "Synthetic no-show test",
    },
    "patch",
  );
  assert.equal(early.status, 422);
  const past = new Date(Date.now() - 3600000).toISOString();
  await db.query("UPDATE visit_requests SET scheduled_at=$1 WHERE id=$2", [
    past,
    visitRef,
  ]);
  const noShow = await change(
    "sales",
    `/api/admin/visits/${visitRef}`,
    {
      expectedVersion: 2,
      status: "no_show",
      scheduledAt: past,
      reason: "Synthetic no-show test",
    },
    "patch",
  );
  assert.equal(noShow.status, 200, JSON.stringify(noShow.body));
  assert.equal(noShow.body.status, "no_show");
});
test("content editor saves drafts but cannot publish; owner must provide verification", async () => {
  const data = {
    title: "Test amenity",
    description: "Synthetic only",
    state: "planned",
    source: "Synthetic source",
    verifiedAt: null,
  };
  assert.equal(
    (
      await change(
        "content_editor",
        "/api/admin/content/test-amenity",
        {
          kind: "amenity",
          data,
          expectedVersion: 0,
          publish: true,
          reason: "Synthetic content test",
        },
        "put",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await change(
        "owner",
        "/api/admin/content/test-amenity",
        {
          kind: "amenity",
          data,
          expectedVersion: 0,
          publish: true,
          reason: "Synthetic content test",
        },
        "put",
      )
    ).status,
    422,
  );
  const draft = await change(
    "content_editor",
    "/api/admin/content/test-amenity",
    {
      kind: "amenity",
      data,
      expectedVersion: 0,
      publish: false,
      reason: "Synthetic content test",
    },
    "put",
  );
  assert.equal(draft.status, 200);
  assert.equal(
    (await request(app).get("/api/public/project")).body.items.some(
      (item) => item.id === "test-amenity",
    ),
    false,
  );
});
test("CSV preview reports row-specific errors and cannot commit them", async () => {
  const r = await change("reviewer", "/api/admin/imports/preview", {
    csv: "draftGeometryId,approvedPlotNumber,sourceBlock\nmissing,BAD,TEST",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.errors[0].row, 2);
  const commit = await change("reviewer", "/api/admin/imports/commit", {
    previewId: r.body.id,
  });
  assert.equal(commit.status, 409);
  const inferred = await change("reviewer", "/api/admin/imports/preview", {
    csv: "draftGeometryId,approvedPlotNumber,sourceBlock,surveyDocumentRevision,ownerReviewedAt,notes\nplot-1-b1-cell-1,TEST-1,PLOT 1,test,2026-11-01,Synthetic owner review",
  });
  assert.equal(inferred.body.valid, 0);
  assert.equal(inferred.body.errors[0].row, 2);
});
test("amenity placement is owner-published, reviewed and can be hidden from public responses", async () => {
  const data = {
    title: "Synthetic garden",
    titleHi: "परीक्षण उद्यान",
    description: "Test only",
    category: "garden",
    location: { lat: 24.466, lon: 74.909 },
    customerVisible: true,
    state: "planned",
    source: "Synthetic test evidence",
    verifiedAt: new Date().toISOString(),
    imageUrl: "",
    imageKind: "illustration",
  };
  const invalid = await change(
    "owner",
    "/api/admin/content/test-amenity",
    {
      kind: "amenity",
      data: { ...data, location: { lat: 0, lon: 0 } },
      expectedVersion: 1,
      publish: true,
      reason: "Synthetic placement review",
    },
    "put",
  );
  assert.equal(invalid.status, 422);
  const published = await change(
    "owner",
    "/api/admin/content/test-amenity",
    {
      kind: "amenity",
      data,
      expectedVersion: 1,
      publish: true,
      reason: "Synthetic placement review",
    },
    "put",
  );
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const items = (await request(app).get("/api/public/project")).body.items;
  const visible = items.find((item) => item.id === "test-amenity");
  assert.equal(visible.published.titleHi, data.titleHi);
  assert.ok(Number.isFinite(visible.published.mapPoint.x));
  const hidden = await change(
    "owner",
    "/api/admin/content/test-amenity",
    {
      kind: "amenity",
      data: { ...data, customerVisible: false },
      expectedVersion: 2,
      publish: true,
      reason: "Synthetic visibility test",
    },
    "put",
  );
  assert.equal(hidden.status, 200);
  assert.equal(
    (await request(app).get("/api/public/project")).body.items.some(
      (item) => item.id === "test-amenity",
    ),
    false,
  );
});
test("owner references stage privately without overwriting and enforce adjustable placement", async () => {
  const body = { reason: "Stage owner-provided reference concepts" };
  assert.equal(
    (
      await request(app)
        .post("/api/admin/amenity-references/stage")
        .set("Origin", origin)
        .send(body)
    ).status,
    401,
  );
  assert.equal(
    (await change("viewer", "/api/admin/amenity-references/stage", body))
      .status,
    403,
  );
  const key = randomUUID();
  const staged = await change(
    "content_editor",
    "/api/admin/amenity-references/stage",
    body,
    "post",
    key,
  );
  const retry = await change(
    "content_editor",
    "/api/admin/amenity-references/stage",
    body,
    "post",
    key,
  );
  assert.equal(staged.status, 200, JSON.stringify(staged.body));
  assert.equal(staged.body.created.length, ownerAmenityReferences.length);
  for (const id of ["owner-ref-pool", "owner-ref-gym"]) {
    const facility = (await db.query("SELECT * FROM content WHERE id=$1", [id]))
      .rows[0];
    assert.equal(facility.draft.state, "planned");
    assert.equal(facility.draft.customerVisible, false);
    assert.equal(facility.published, null);
    assert.match(facility.draft.description, /Proposed/);
    assert.equal(
      facility.draft.imageUrl,
      `/assets/concepts/${ownerAmenityReferences.find((ref) => ref.id === id).image}`,
    );
  }
  assert.deepEqual(staged.body, retry.body);
  let item = (
    await db.query("SELECT * FROM content WHERE id=$1", ["owner-ref-fountain"])
  ).rows[0];
  assert.equal(item.published, null);
  assert.equal(item.draft.source, "Owner-provided screenshot reference");
  assert.equal(item.draft.customerVisible, false);
  assert.equal(item.draft.placementPrecision, "approximate");
  assert.equal(item.draft.state, "confirmation_pending");
  const revised = {
    ...item.draft,
    visualScale: 1.4,
    visualRotation: 25,
    description: "Reviewed reference; status unverified.",
  };
  const edited = await change(
    "content_editor",
    "/api/admin/content/owner-ref-fountain",
    {
      kind: "amenity",
      data: revised,
      expectedVersion: item.version,
      publish: false,
      reason: "Adjust reference marker appearance",
    },
    "put",
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const repeated = await change(
    "content_editor",
    "/api/admin/amenity-references/stage",
    body,
  );
  assert.equal(repeated.body.created.length, 0);
  item = (
    await db.query("SELECT * FROM content WHERE id=$1", ["owner-ref-fountain"])
  ).rows[0];
  assert.equal(item.draft.visualScale, 1.4);
  assert.equal(item.draft.visualRotation, 25);
  const outside = await change(
    "content_editor",
    "/api/admin/content/owner-ref-fountain",
    {
      kind: "amenity",
      data: { ...item.draft, location: { lat: 24.466, lon: 74.909 } },
      expectedVersion: item.version,
      publish: false,
      reason: "Try an out of area marker",
    },
    "put",
  );
  assert.equal(outside.status, 422);
  assert.match(outside.body.error, /owner-indicated plan area/);
  const publish = await change(
    "owner",
    "/api/admin/content/owner-ref-fountain",
    {
      kind: "amenity",
      data: {
        ...item.draft,
        customerVisible: true,
        verifiedAt: new Date().toISOString(),
      },
      expectedVersion: item.version,
      publish: true,
      reason: "Review approximate reference placement",
    },
    "put",
  );
  assert.equal(publish.status, 200, JSON.stringify(publish.body));
  const publicItem = (
    await request(app).get("/api/public/project")
  ).body.items.find((entry) => entry.id === "owner-ref-fountain");
  assert.equal(publicItem.published.placementPrecision, "approximate");
  assert.equal(publicItem.published.visualScale, 1.4);
  assert.equal(publicItem.published.visualRotation, 25);
  assert.equal(publicItem.published.state, "confirmation_pending");
  assert.ok(Number.isFinite(publicItem.published.mapPoint.x));
  const history = await db.query(
    "SELECT action FROM audit_logs WHERE entity_id=$1",
    ["owner-ref-fountain"],
  );
  assert.ok(
    history.rows.some((row) => row.action === "amenity.reference.stage"),
  );
  assert.ok(history.rows.some((row) => row.action === "content.update"));
});
test("proposed leisure facilities require authorised review and retain their proposed state", async () => {
  for (const id of ["owner-ref-pool", "owner-ref-gym"]) {
    const item = (await db.query("SELECT * FROM content WHERE id=$1", [id]))
      .rows[0];
    const reviewed = {
      ...item.draft,
      customerVisible: true,
      visualScale: 1.1,
      visualRotation: 12,
      verifiedAt: new Date().toISOString(),
    };
    const input = {
      kind: "amenity",
      data: reviewed,
      expectedVersion: item.version,
      publish: true,
      reason: "Review proposed concept for synthetic test",
    };
    assert.equal(
      (await change("content_editor", `/api/admin/content/${id}`, input, "put"))
        .status,
      403,
    );
    const published = await change(
      "owner",
      `/api/admin/content/${id}`,
      input,
      "put",
    );
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const publicItem = (
      await request(app).get("/api/public/project")
    ).body.items.find((entry) => entry.id === id);
    assert.equal(publicItem.published.state, "planned");
    assert.equal(publicItem.published.visualScale, 1.1);
    assert.equal(publicItem.published.visualRotation, 12);
    assert.match(publicItem.published.description, /Proposed/);
    const history = await db.query(
      "SELECT action FROM audit_logs WHERE entity_id=$1",
      [id],
    );
    assert.ok(history.rows.some((row) => row.action === "content.update"));
  }
});
test("roundabout gardens save independent placement changes with authorisation and audit", async () => {
  const firstId = "owner-ref-roundabout-garden-ne";
  const secondId = "owner-ref-roundabout-garden-se";
  const first = (await db.query("SELECT * FROM content WHERE id=$1", [firstId]))
    .rows[0];
  const second = (
    await db.query("SELECT * FROM content WHERE id=$1", [secondId])
  ).rows[0];
  const changed = {
    ...first.draft,
    location: planToGeographic({ x: 185.36, y: 128.2 }),
    visualScale: 1.22,
    visualRotation: 73.5,
  };
  const body = {
    kind: "amenity",
    data: changed,
    expectedVersion: first.version,
    publish: false,
    reason: "Synthetic independent garden placement review",
  };
  assert.equal(
    (await change("viewer", `/api/admin/content/${firstId}`, body, "put"))
      .status,
    403,
  );
  assert.equal(
    (
      await change(
        "content_editor",
        `/api/admin/content/${firstId}`,
        body,
        "put",
      )
    ).status,
    200,
  );
  const updated = (
    await db.query("SELECT * FROM content WHERE id=$1", [firstId])
  ).rows[0];
  const untouched = (
    await db.query("SELECT * FROM content WHERE id=$1", [secondId])
  ).rows[0];
  assert.equal(updated.draft.visualScale, 1.22);
  assert.equal(updated.draft.visualRotation, 73.5);
  assert.deepEqual(updated.draft.location, changed.location);
  assert.deepEqual(untouched.draft, second.draft);
  assert.equal(untouched.version, second.version);
  assert.equal(updated.published, null);
  const published = await change(
    "owner",
    `/api/admin/content/${firstId}`,
    {
      ...body,
      expectedVersion: updated.version,
      publish: true,
      data: {
        ...updated.draft,
        customerVisible: true,
        verifiedAt: new Date().toISOString(),
      },
    },
    "put",
  );
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const live = (await request(app).get("/api/public/project")).body.items.find(
    (item) => item.id === firstId,
  );
  assert.equal(live.published.visualRotation, 73.5);
  assert.equal(live.published.visualScale, 1.22);
  assert.ok(Math.abs(live.published.mapPoint.x - 185.36) < 0.03);
  const audit = await db.query(
    "SELECT action FROM audit_logs WHERE entity_id=$1",
    [firstId],
  );
  assert.ok(audit.rows.some((row) => row.action === "amenity.reference.stage"));
  assert.ok(
    audit.rows.filter((row) => row.action === "content.update").length >= 2,
  );
});
test("image upload stays private until authorised publication and disappears on unpublish", async () => {
  const png = await readFile("public/assets/plot-dimensions-example.png");
  const unauthorised = await request(app)
    .post("/api/admin/media")
    .set("Origin", origin)
    .set("Content-Type", "image/png")
    .send(png);
  assert.equal(unauthorised.status, 401);
  const denied = await clients.sales.agent
    .post("/api/admin/media")
    .set("Origin", origin)
    .set("X-CSRF-Token", clients.sales.csrf)
    .set("Content-Type", "image/png")
    .send(png);
  assert.equal(denied.status, 403);
  const invalid = await clients.owner.agent
    .post("/api/admin/media")
    .set("Origin", origin)
    .set("X-CSRF-Token", clients.owner.csrf)
    .set("Content-Type", "image/png")
    .send(Buffer.from("<html>fake image</html>"));
  assert.equal(invalid.status, 422);
  const staged = await clients.owner.agent
    .post("/api/admin/media")
    .set("Origin", origin)
    .set("X-CSRF-Token", clients.owner.csrf)
    .set("Content-Type", "image/png")
    .send(png);
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  assert.equal((await request(app).get(staged.body.url)).status, 404);
  const privateUrl = staged.body.url.replace("/api/public/", "/api/admin/");
  assert.equal((await request(app).get(privateUrl)).status, 401);
  assert.equal((await clients.sales.agent.get(privateUrl)).status, 403);
  assert.equal((await clients.owner.agent.get(privateUrl)).status, 200);
  const data = {
    title: "Synthetic image",
    description: "Test only",
    url: staged.body.url,
    category: "concept",
    revision: "test",
    source: "Synthetic source",
    verifiedAt: new Date().toISOString(),
  };
  const published = await change(
    "owner",
    "/api/admin/content/test-image",
    {
      kind: "media",
      data,
      expectedVersion: 0,
      publish: true,
      reason: "Synthetic media approval",
    },
    "put",
  );
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const publicImage = await request(app).get(staged.body.url);
  assert.equal(publicImage.status, 200);
  assert.match(publicImage.headers["content-type"], /image\/png/);
  assert.equal(publicImage.headers["cache-control"], "no-store");
  const unpublished = await change(
    "owner",
    "/api/admin/content/test-image",
    {
      kind: "media",
      data,
      expectedVersion: 1,
      publish: false,
      reason: "Synthetic media withdrawal",
    },
    "put",
  );
  assert.equal(unpublished.status, 200);
  assert.equal((await request(app).get(staged.body.url)).status, 404);
});
test("CSV valid import commits drafts once and preserves existing IDs", async () => {
  const csv =
    "draftGeometryId,approvedPlotNumber,sourceBlock,approvedBlock,surveyDocumentRevision,ownerReviewedAt,notes,availability\nplot-1-b1-cell-1,TEST-CSV,PLOT 1,TEST,test-1,2026-11-01,Synthetic CSV test review,unverified";
  const r = await change("reviewer", "/api/admin/imports/preview", { csv });
  assert.equal(r.body.errors.length, 0, JSON.stringify(r.body));
  const key = randomUUID();
  const a = await change(
      "reviewer",
      "/api/admin/imports/commit",
      { previewId: r.body.id },
      "post",
      key,
    ),
    b = await change(
      "reviewer",
      "/api/admin/imports/commit",
      { previewId: r.body.id },
      "post",
      key,
    );
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual(a.body, b.body);
  assert.equal(a.body.publication, "draft");
  assert.equal(
    (await db.query("SELECT id FROM plots WHERE id=$1", [approved.id])).rows
      .length,
    1,
  );
});
test("reviewed geometry reassignment preserves plot ID, clears evidence and retains undo provenance", async () => {
  const before = (
    await db.query("SELECT * FROM plots WHERE id=$1", [approved.id])
  ).rows[0];
  const p = await change("reviewer", "/api/admin/geometry-proposals", {
    plotId: approved.id,
    draftId: "plot-1-b2-cell-2",
    expectedVersion: approved.version,
    reason: "Synthetic reassignment review",
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const r = await change(
    "owner",
    `/api/admin/geometry-proposals/${p.body.id}/decide`,
    { approve: true, reason: "Synthetic owner geometry review" },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = (await db.query("SELECT * FROM plots WHERE id=$1", [approved.id]))
    .rows[0];
  assert.equal(row.status, "unverified");
  assert.equal(row.verified_at, null);
  assert.deepEqual(row.data.dimensions, []);
  assert.equal(row.data.areaSqM, null);
  assert.equal(row.data.roadWidthMetres, null);
  assert.equal(row.data.facing, null);
  assert.equal(row.data.corner, null);
  assert.equal(row.price_visible, false);
  if (before.status !== "unverified") {
    const history = (
      await db.query(
        "SELECT old_status,new_status,reason FROM inventory_status_history WHERE plot_id=$1 ORDER BY created_at DESC LIMIT 1",
        [approved.id],
      )
    ).rows[0];
    assert.equal(history.old_status, before.status);
    assert.equal(history.new_status, "unverified");
    assert.equal(history.reason, "Synthetic owner geometry review");
  }
});
test("public form rate limit is persistent and returns a truthful 429", async () => {
  let last;
  for (let i = 0; i < 14; i++)
    last = await request(app)
      .post("/api/enquiries")
      .set("Origin", origin)
      .set("Idempotency-Key", randomUUID())
      .send({ ...contact, plotIds: [] });
  assert.equal(last.status, 429);
});
test("geometry revisions stage immutable approximate data without changing approved mappings", async () => {
  const f = (await import("node:fs")).readFileSync(
    "public/data/reconstructed-cells.geojson",
    "utf8",
  );
  const feature = JSON.parse(f).features[0];
  const input = {
    sourceDocument: "Synthetic revised source",
    sourceRevision: "TEST-NEW-REVISION",
    reason: "Synthetic test geometry source proposal",
    features: [
      {
        type: "Feature",
        properties: { label: "TEST-REV", block: "TEST" },
        geometry: feature.geometry,
      },
    ],
  };
  const key = randomUUID(),
    a = await change(
      "reviewer",
      "/api/admin/geometry-revisions",
      input,
      "post",
      key,
    ),
    b = await change(
      "reviewer",
      "/api/admin/geometry-revisions",
      input,
      "post",
      key,
    );
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.revisionId, b.body.revisionId);
  assert.equal(a.body.cells[0].reviewRequired, true);
  assert.equal(a.body.cells[0].verifiedDimensions, null);
  assert.equal(
    (
      await db.query("SELECT draft_id FROM plot_geometry WHERE plot_id=$1", [
        approved.id,
      ])
    ).rows[0].draft_id,
    "plot-1-b2-cell-2",
  );
});
test("staff password changes revoke sessions and never put passwords in audit", async () => {
  const body = {
    currentPassword: password,
    newPassword: "Synthetic-replacement-only-3399!",
  };
  const r = await change("content_editor", "/api/admin/password", body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(
    (await clients.content_editor.agent.get("/api/auth/session")).status,
    401,
  );
  const events = JSON.stringify(
    (await db.query("SELECT * FROM audit_logs WHERE action='user.password'"))
      .rows,
  );
  assert.ok(!events.includes(body.newPassword));
  assert.ok(!events.includes(body.currentPassword));
});
