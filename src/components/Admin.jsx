import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { can, roles, statuses, parseLength } from "../../shared/domain.mjs";
import { api, downloadJSON } from "../services/api";
import PresentationEditor from "./PresentationEditor";
import FootprintReview from "./FootprintReview";
import StructureFields from "./StructureFields";
const MapPositionEditor = lazy(() => import("./MapPositionEditor"));
function EvidenceEditor({
  initial,
  onSubmit,
  button = "Save identity draft",
  busy,
}) {
  const [value, setValue] = useState(initial),
    [sides, setSides] = useState(initial.dimensions || []),
    [documentIds, setDocumentIds] = useState(
      (initial.documentIds || []).join(", "),
    ),
    [error, setError] = useState("");
  const update = (key, v) => setValue((s) => ({ ...s, [key]: v }));
  function submit(e) {
    e.preventDefault();
    setError("");
    try {
      onSubmit({
        ...value,
        documentIds: [
          ...new Set(
            documentIds
              .split(",")
              .map((id) => id.trim())
              .filter(Boolean),
          ),
        ],
        areaSqM: value.areaSqM === "" ? null : value.areaSqM,
        roadWidthMetres:
          value.roadWidthMetres === "" ? null : value.roadWidthMetres,
        dimensions: sides.map((d) => ({
          ...d,
          metres: parseLength(d.sourceText),
        })),
      });
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <legend>Reviewed identity & dimensions</legend>
        <div className="form-grid">
          <label>
            Approved plot number
            <input
              required
              value={value.number}
              onChange={(e) => update("number", e.target.value)}
            />
          </label>
          <label>
            Approved block
            <input
              required
              placeholder="Enter the owner-approved block"
              value={value.block}
              onChange={(e) => update("block", e.target.value)}
            />
          </label>
          <label>
            Approved phase (optional)
            <input
              value={value.phase ?? ""}
              onChange={(e) => update("phase", e.target.value)}
            />
          </label>
          {[
            ["corner", "Verified corner plot"],
            ["parkFacing", "Verified park-facing plot"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <select
                value={value[key] == null ? "" : value[key] ? "yes" : "no"}
                onChange={(e) =>
                  update(
                    key,
                    e.target.value === "" ? null : e.target.value === "yes",
                  )
                }
              >
                <option value="">Not provided</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          ))}
          <label>
            Verified area (m², optional)
            <input
              type="number"
              min="0.01"
              step="any"
              value={value.areaSqM ?? ""}
              onChange={(e) =>
                update(
                  "areaSqM",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
            />
          </label>
          <label>
            Original area text & unit
            <input
              value={value.areaSourceText}
              onChange={(e) => update("areaSourceText", e.target.value)}
              placeholder="Keep the exact source value"
            />
          </label>
          <label>
            Verified road width (m, optional)
            <input
              type="number"
              min="0.01"
              step="any"
              value={value.roadWidthMetres ?? ""}
              onChange={(e) =>
                update(
                  "roadWidthMetres",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
            />
          </label>
          <label>
            Verified facing
            <select
              value={value.facing || ""}
              onChange={(e) => update("facing", e.target.value || null)}
            >
              <option value="">Not provided</option>
              {["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Verified plot type
            <select
              value={value.plotType}
              onChange={(e) => update("plotType", e.target.value)}
            >
              {["not_provided", "residential", "commercial", "mixed"].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Reference document
            <input
              required
              value={value.sourceDocument}
              onChange={(e) => update("sourceDocument", e.target.value)}
            />
          </label>
          <label>
            Document revision / date
            <input
              required
              value={value.sourceRevision}
              onChange={(e) => update("sourceRevision", e.target.value)}
            />
          </label>
          <label>
            Published document IDs (optional, comma-separated)
            <input
              value={documentIds}
              onChange={(e) => setDocumentIds(e.target.value)}
              placeholder="Content IDs approved for this plot"
            />
          </label>
        </div>
        <h3>Verified named sides</h3>
        <p className="small">
          Use explicit units: 25′6″ or 6.7 m. Leave geometry edge blank if its
          correspondence is uncertain. Front/rear names need verified
          orientation.
        </p>
        {sides.map((d, i) => (
          <div className="side-editor" key={i}>
            <label>
              Side name
              <input
                required
                value={d.name}
                onChange={(e) =>
                  setSides((s) =>
                    s.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              Source length text
              <input
                required
                value={d.sourceText}
                onChange={(e) =>
                  setSides((s) =>
                    s.map((x, j) =>
                      j === i ? { ...x, sourceText: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              Drawing edge (1-based)
              <input
                type="number"
                min="1"
                value={d.edgeIndex == null ? "" : d.edgeIndex + 1}
                onChange={(e) =>
                  setSides((s) =>
                    s.map((x, j) => {
                      if (j !== i) return x;
                      const { edgeIndex: _, ...rest } = x;
                      return e.target.value
                        ? { ...rest, edgeIndex: Number(e.target.value) - 1 }
                        : rest;
                    }),
                  )
                }
              />
            </label>
            <button
              type="button"
              onClick={() => setSides((s) => s.filter((_, j) => i !== j))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setSides((s) => [
              ...s,
              { name: `Side ${s.length + 1}`, metres: 1, sourceText: "" },
            ])
          }
        >
          Add verified side
        </button>
        <label>
          Review evidence / reason (required)
          <textarea
            required
            minLength={8}
            value={value.reviewNote}
            onChange={(e) => update("reviewNote", e.target.value)}
          />
        </label>
        <button className="primary">{button}</button>
        {error && <p role="alert">{error}</p>}
      </fieldset>
    </form>
  );
}
const blankEvidence = () => ({
  number: "",
  block: "",
  phase: "",
  corner: null,
  parkFacing: null,
  documentIds: [],
  plotType: "not_provided",
  areaSqM: null,
  areaSourceText: "",
  dimensions: [],
  roadWidthMetres: null,
  facing: null,
  sourceDocument: "Supplied north-oriented PDF",
  sourceRevision: "",
  reviewNote: "",
});
function Pager({ offset, total, limit = 50, onChange }) {
  if (!total) return null;
  return (
    <nav className="admin-pager" aria-label="Result pages">
      <button
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous page
      </button>
      <span>
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <button
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next page
      </button>
    </nav>
  );
}
export default function Admin() {
  const [user, setUser] = useState(null),
    [checking, setChecking] = useState(true),
    [tab, setTab] = useState("inventory"),
    [data, setData] = useState({}),
    [overview, setOverview] = useState({}),
    [overviewError, setOverviewError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [csv, setCsv] = useState(""),
    [preview, setPreview] = useState(null),
    [inventoryCsv, setInventoryCsv] = useState(""),
    [inventoryPreview, setInventoryPreview] = useState(null),
    [pageOffset, setPageOffset] = useState(0),
    [auditFilter, setAuditFilter] = useState(""),
    [geometryInput, setGeometryInput] = useState("");
  useEffect(() => {
    api("/auth/session")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  const endpoint = {
    inventory: "/admin/plots",
    review: "/admin/review",
    leads: "/admin/enquiries",
    visits: "/admin/enquiries",
    content: "/admin/content",
    presentation: "/admin/presentation",
    access: "/admin/users",
    audit: "/admin/audit",
    geometry: "/admin/geometry-proposals",
  };
  const requestController = useRef();
  const importKeys = useRef(new Map());
  function importKey(previewId) {
    if (!importKeys.current.has(previewId))
      importKeys.current.set(previewId, crypto.randomUUID());
    return importKeys.current.get(previewId);
  }
  async function refresh() {
    if (!user || !endpoint[tab]) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setOverviewError("");
    // Overview is supplementary: a failed or stalled summary must not hide
    // the independently loaded records in the selected owner workspace.
    void api("/admin/overview", { signal: controller.signal })
      .then((summary) => {
        if (!controller.signal.aborted) setOverview(summary.counts);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setOverview({});
          setOverviewError("Overview unavailable. Records can still be used.");
        }
      });
    try {
      const params = new URLSearchParams();
      if (["leads", "visits", "audit"].includes(tab)) {
        params.set("limit", "50");
        params.set("offset", String(pageOffset));
        if (tab === "audit" && auditFilter) params.set("entity", auditFilter);
      }
      const path = `${endpoint[tab]}${params.size ? `?${params}` : ""}`;
      const result = await api(path, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setData(result);
      }
    } catch (e) {
      if (!controller.signal.aborted && e.name !== "AbortError") setError(e.message);
    }
  }
  useEffect(() => {
    setData({});
    setError("");
    setSelected("");
    setQuery("");
    setPageOffset(0);
    setAuditFilter("");
  }, [user, tab]);
  useEffect(() => {
    refresh();
    return () => requestController.current?.abort();
  }, [user, tab, pageOffset, auditFilter]);
  async function run(fn, message = "Saved.", refreshAfter = true) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      const warnings = result?.structureAssessment?.warnings;
      setNotice([message, ...(Array.isArray(warnings) ? warnings : [])].join(" "));
      if (refreshAfter) await refresh();
      return result;
    } catch (e) {
      setError(
        `${e.message}${
          e.fields
            ? " " +
              Object.entries(e.fields)
                .map(([k, v]) => `${k}: ${v}`)
                .join("; ")
            : ""
        }`,
      );
      return null;
    } finally {
      setBusy(false);
    }
  }
  const mutate = (path, body, method = "POST", key = crypto.randomUUID()) =>
    api(path, { method, body, csrf: user.csrf, key });
  if (checking) return <p>Checking secure session…</p>;
  if (!user)
    return (
      <section className="login">
        <span className="eyebrow">PRIVATE OWNER WORKSPACE</span>
        <h1>Welcome back.</h1>
        <p>
          Use your staff account to review inventory and respond to enquiries.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const u = await api("/auth/login", {
                method: "POST",
                body: { email: f.get("email"), password: f.get("password") },
              });
              setUser(u);
            }, "Signed in.");
          }}
        >
          <label>
            Email
            <input type="email" name="email" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        {error && (
          <p role="alert" className="warning">
            {error}
          </p>
        )}
        <p className="small">
          No default credentials. The initial owner account is created privately
          during database setup. Public users cannot modify inventory.
        </p>
      </section>
    );
  const tabs = [
    ["inventory", "Inventory", true],
    ["review", "Data review", can(user.role, "review")],
    ["leads", "Enquiries", can(user.role, "leads")],
    ["visits", "Visits", can(user.role, "leads")],
    [
      "imports",
      "CSV import",
      can(user.role, "review") || can(user.role, "inventory"),
    ],
    ["geometry", "Geometry revisions", can(user.role, "review")],
    ["content", "Content", can(user.role, "content")],
    ["presentation", "Illustrated layout", can(user.role, "content")],
    ["access", "Staff access", can(user.role, "access")],
    ["audit", "Audit history", can(user.role, "audit")],
    ["account", "My account", true],
  ];
  const cells =
    data.cells?.filter((c) =>
      `${c.data.label} ${c.data.block} ${c.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) || [];
  const cell = cells.find((c) => c.id === selected),
    record = data.plots?.find((p) => p.id === selected);
  return (
    <>
      <div className="admin-header">
        <div>
          <span className="eyebrow">SHUBH MANGAL · OWNER WORKSPACE</span>
          <h1>Good to see you, {user.name}.</h1>
          <p>
            Role: {user.role}. Draft, reviewed and published records remain
            separate.
          </p>
        </div>
        <button
          onClick={() =>
            run(
              async () => {
                await mutate("/admin/logout", {});
                setUser(null);
              },
              "Signed out.",
              false,
            )
          }
        >
          Sign out
        </button>
      </div>
      <div className="admin-metrics">
        {Object.entries(overview).map(([key, value]) => (
          <div key={key}>
            <b>{value}</b>
            <span>
              {
                {
                  published: "Published plots",
                  drafts: "Draft identities",
                  newEnquiries: "New enquiries",
                  dueFollowUps: "Follow-ups due",
                  requestedVisits: "Requested visits",
                  confirmedVisits: "Confirmed visits",
                }[key]
              }
            </span>
          </div>
        ))}
      </div>
      <nav className="admin-tabs" aria-label="Owner tools">
        {tabs
          .filter((t) => t[2])
          .map(([id, name]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {name}
            </button>
          ))}
      </nav>
      {error && (
        <p className="warning" role="alert">
          {error} <button onClick={refresh}>Reload records</button>
        </p>
      )}
      {overviewError && (
        <p className="warning" role="alert">{overviewError}</p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {tab === "review" && (
        <>
          <div className="section-title">
            <h2>Source reconciliation</h2>
            <span>
              {data.cells?.filter((c) => !c.plot_id).length ?? "…"} unmapped
              cells
            </span>
          </div>
          <p>
            All 556 source cells require review, including the 32 missing or
            duplicate-label cases. The PDF governs only after owner review. A
            unique label match is not approval.
          </p>
          <label>
            Find a draft cell
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="admin-split">
            <div className="review-list">
              {cells.map((c) => (
                <button
                  key={c.id}
                  className="plot-row"
                  onClick={() => setSelected(c.id)}
                  aria-pressed={selected === c.id}
                >
                  <span>
                    <b>{c.data.label}</b>
                    <small>
                      {c.data.block} ·{" "}
                      {c.data.identityReviewRequired
                        ? "Manual identity issue"
                        : "Owner review pending"}
                      {c.plot_id ? " · Mapped" : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            <div>
              {cell ? (
                <>
                  <h3>
                    {cell.data.label} · {cell.data.block}
                  </h3>
                  <div className="review-images">
                    <svg
                      viewBox={`${cell.data.bounds[0] - 3} ${cell.data.bounds[1] - 3} ${cell.data.bounds[2] - cell.data.bounds[0] + 6} ${cell.data.bounds[3] - cell.data.bounds[1] + 6}`}
                      role="img"
                      aria-label="Selected approximate source cell"
                    >
                      <path
                        d={cell.data.path}
                        fill="#dbe4e8"
                        stroke="#4b6975"
                        strokeWidth=".3"
                      />
                      {cell.data.edges.map((e, i) => (
                        <text
                          key={i}
                          x={(e.a[0] + e.b[0]) / 2}
                          y={(e.a[1] + e.b[1]) / 2}
                          fontSize="1.1"
                        >
                          {i + 1}
                        </text>
                      ))}
                    </svg>
                    <a
                      href="/assets/survey-plan-north.png"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src="/assets/survey-plan-north.png"
                        alt="Reference PDF plan — open full resolution"
                      />
                    </a>
                  </div>
                  <p className="warning">
                    Candidates: {cell.data.labelCandidates.join(", ") || "None"}
                    . Map-derived area: {cell.data.areaSqMApprox} m². Never copy
                    this into verified dimensions without source evidence.
                  </p>
                  {cell.plot_id ? (
                    <p>
                      Mapped to approved ID {cell.plot_id}. Continue in
                      Inventory.
                    </p>
                  ) : (
                    <EvidenceEditor
                      key={cell.id}
                      busy={busy}
                      initial={blankEvidence()}
                      onSubmit={(v) =>
                        run(
                          () =>
                            mutate("/admin/reconcile", {
                              draftId: cell.id,
                              data: v,
                            }),
                          "Identity staged as draft. Review, then owner publication are separate steps.",
                        )
                      }
                    />
                  )}
                </>
              ) : (
                <p>Select a cell to inspect it beside the PDF.</p>
              )}
            </div>
          </div>
        </>
      )}
      {tab === "inventory" && (
        <>
          <h2>Approved identities & inventory</h2>
          <p>
            {data.plots?.length || 0} reconciled records ·{" "}
            {data.plots?.filter((p) => p.publication === "published").length ||
              0}{" "}
            published. No drafts are automatically promoted.
          </p>
          {!data.plots?.length ? (
            <div className="note">
              No approved identities yet. Reconcile a source cell in Data
              review.
            </div>
          ) : (
            <>
              <label>
                Find an approved record
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Plot number, block or ID"
                />
              </label>
              <label>
                Choose a record
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">Select…</option>
                  {data.plots
                    .filter((p) =>
                      `${p.number} ${p.block} ${p.id}`
                        .toLowerCase()
                        .includes(query.toLowerCase().trim()),
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.block} / {p.number} · {p.publication} · {p.status}
                      </option>
                    ))}
                </select>
              </label>
              {record && (
                <div key={`${record.id}-${record.version}`}>
                  <p className="code-text">
                    Immutable ID: {record.id} · version {record.version}
                  </p>
                  <div className="note">
                    Current publication: {record.publication} · status:{" "}
                    {record.status}. Reviewed area:{" "}
                    {record.data.areaSqM ?? "Not supplied"} m²; map-derived
                    area: {record.geometry.areaSqMApprox} m².
                    {record.data.areaSqM &&
                    Math.abs(
                      record.data.areaSqM - record.geometry.areaSqMApprox,
                    ) /
                      record.data.areaSqM >
                      0.05
                      ? " Discrepancy exceeds 5%; inspect the source, do not overwrite approved values."
                      : ""}
                  </div>
                  <div className="admin-split">
                    <div>
                      {can(user.role, "review") && (
                        <EvidenceEditor
                          initial={record.data}
                          busy={busy}
                          button="Save revised evidence as draft"
                          onSubmit={(v) =>
                            run(
                              () =>
                                mutate(
                                  `/admin/plots/${record.id}`,
                                  {
                                    expectedVersion: record.version,
                                    data: v,
                                    reason: v.reviewNote,
                                  },
                                  "PATCH",
                                ),
                              "Evidence saved; publication reset to draft.",
                            )
                          }
                        />
                      )}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          body = {
                            expectedVersion: record.version,
                            reason: f.get("reason"),
                          };
                        if (can(user.role, "inventory")) {
                          body.status = f.get("status");
                          body.priceINR =
                            f.get("price") === ""
                              ? null
                              : Number(f.get("price"));
                          body.priceVisible = f.get("priceVisible") === "on";
                        }
                        if (f.get("publication"))
                          body.publication = f.get("publication");
                        run(
                          () =>
                            mutate(`/admin/plots/${record.id}`, body, "PATCH"),
                          "Inventory saved with audit history.",
                        );
                      }}
                    >
                      <fieldset disabled={busy}>
                        <legend>Inventory & publication</legend>
                        {can(user.role, "inventory") && (
                          <>
                            <label>
                              Verified inventory status
                              <select
                                name="status"
                                defaultValue={record.status}
                              >
                                {statuses.map((s) => (
                                  <option key={s}>{s}</option>
                                ))}
                              </select>
                            </label>
                            <label>
                              Price (INR, optional)
                              <input
                                name="price"
                                type="number"
                                min="0"
                                step="any"
                                defaultValue={record.price_inr ?? ""}
                              />
                            </label>
                            <label className="check">
                              <input
                                type="checkbox"
                                name="priceVisible"
                                defaultChecked={record.price_visible}
                              />{" "}
                              Publish this confirmed price
                            </label>
                          </>
                        )}
                        {can(user.role, "review") && (
                          <label>
                            Publication transition
                            <select name="publication" defaultValue="">
                              <option value="">Keep current state</option>
                              <option value="reviewed">Mark reviewed</option>
                              {can(user.role, "publish") && (
                                <>
                                  <option value="published">
                                    Publish reviewed record
                                  </option>
                                  <option value="draft">Return to draft</option>
                                  <option value="archived">Archive</option>
                                </>
                              )}
                            </select>
                          </label>
                        )}
                        <label>
                          Reason for change
                          <textarea name="reason" minLength={8} required />
                        </label>
                        {(can(user.role, "inventory") ||
                          can(user.role, "review")) && (
                          <button className="primary">Save transaction</button>
                        )}
                      </fieldset>
                    </form>
                  </div>
                </div>
              )}
            </>
          )}
          {can(user.role, "review") && (
            <button
              onClick={() =>
                run(
                  async () =>
                    downloadJSON(
                      await api("/admin/export"),
                      "shubh-approved-inventory.json",
                    ),
                  "Authorised inventory export downloaded.",
                )
              }
            >
              Export inventory & ID mappings
            </button>
          )}
        </>
      )}
      {["leads", "visits"].includes(tab) && (
        <>
          <h2>{tab === "leads" ? "Enquiry follow-up" : "Visit requests"}</h2>
          <p>
            Requests are not reservations. Requested visits are not confirmed
            bookings.
          </p>
          {tab === "leads"
            ? (data.enquiries || []).map((lead) => (
                <article
                  className="admin-card"
                  key={`${lead.id}-${lead.version}`}
                >
                  <h3>
                    {lead.data.name} · {lead.stage}
                  </h3>
                  <p>
                    {lead.data.phone} · {lead.data.email} · {lead.data.language}
                  </p>
                  <p>
                    Preferred contact: {lead.data.preferredContact || "phone"}
                  </p>
                  <p>{lead.data.message}</p>
                  <p>
                    Plots:{" "}
                    {lead.data.plots
                      .map((p) => `${p.label} (${p.status} when submitted)`)
                      .join(", ") || "General enquiry"}
                  </p>
                  <small>
                    Reference {lead.id} ·{" "}
                    {new Date(lead.created_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}{" "}
                    IST
                  </small>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      run(
                        () =>
                          mutate(
                            `/admin/enquiries/${lead.id}`,
                            {
                              expectedVersion: lead.version,
                              stage: f.get("stage"),
                              notes: f.get("notes"),
                              assignedTo: f.get("assignedTo") || null,
                              nextActionAt: f.get("next")
                                ? new Date(
                                    `${f.get("next")}+05:30`,
                                  ).toISOString()
                                : null,
                              reason: f.get("reason"),
                            },
                            "PATCH",
                          ),
                        "Lead updated.",
                      );
                    }}
                  >
                    <div className="form-grid">
                      <label>
                        Stage
                        <select name="stage" defaultValue={lead.stage}>
                          {["new", "contacted", "qualified", "closed"].map(
                            (s) => (
                              <option key={s}>{s}</option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Assigned staff
                        <select
                          name="assignedTo"
                          defaultValue={lead.assigned_to || ""}
                        >
                          <option value="">Unassigned</option>
                          {lead.assigned_to &&
                            !data.staff?.some(
                              (person) => person.id === lead.assigned_to,
                            ) && (
                              <option value={lead.assigned_to}>
                                Previously assigned (inactive)
                              </option>
                            )}
                          {(data.staff || []).map((person) => (
                            <option value={person.id} key={person.id}>
                              {person.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Next action (IST)
                        <input
                          type="datetime-local"
                          name="next"
                          defaultValue={
                            lead.next_action_at
                              ? new Date(
                                  new Date(lead.next_action_at).getTime() +
                                    19800000,
                                )
                                  .toISOString()
                                  .slice(0, 16)
                              : ""
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Private staff notes
                      <textarea name="notes" defaultValue={lead.notes} />
                    </label>
                    <label>
                      Reason
                      <input name="reason" minLength={8} required />
                    </label>
                    <button disabled={busy}>Save follow-up</button>
                  </form>
                </article>
              ))
            : (data.visits || []).map((v) => {
                const lead =
                  v.enquiry_data ||
                  data.enquiries?.find((e) => e.id === v.enquiry_id)?.data;
                return (
                  <article className="admin-card" key={`${v.id}-${v.version}`}>
                    <h3>
                      {lead?.name || "Visitor"} · {v.status}
                    </h3>
                    <p>
                      Requested:{" "}
                      {new Date(v.preferred_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                      })}{" "}
                      IST
                    </p>
                    <p>
                      Agreed slot:{" "}
                      {v.scheduled_at
                        ? new Date(v.scheduled_at).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                          })
                        : "Not confirmed"}
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        run(
                          () =>
                            mutate(
                              `/admin/visits/${v.id}`,
                              {
                                expectedVersion: v.version,
                                status: f.get("status"),
                                scheduledAt: f.get("scheduled")
                                  ? new Date(
                                      `${f.get("scheduled")}+05:30`,
                                    ).toISOString()
                                  : null,
                                reason: f.get("reason"),
                              },
                              "PATCH",
                            ),
                          "Visit status updated; no automatic notification sent.",
                        );
                      }}
                    >
                      <div className="form-grid">
                        <label>
                          Next status
                          <select name="status">
                            {{
                              requested: [
                                "contacted",
                                "confirmed",
                                "cancelled",
                              ],
                              contacted: [
                                "confirmed",
                                "rescheduled",
                                "cancelled",
                              ],
                              confirmed: [
                                "completed",
                                "no_show",
                                "rescheduled",
                                "cancelled",
                              ],
                              rescheduled: [
                                "confirmed",
                                "completed",
                                "no_show",
                                "cancelled",
                              ],
                              completed: [],
                              no_show: [],
                              cancelled: [],
                            }[v.status].map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Agreed date/time (IST)
                          <input
                            type="datetime-local"
                            name="scheduled"
                            defaultValue={
                              v.scheduled_at
                                ? new Date(
                                    new Date(v.scheduled_at).getTime() +
                                      19800000,
                                  )
                                    .toISOString()
                                    .slice(0, 16)
                                : ""
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Reason
                        <input name="reason" minLength={8} required />
                      </label>
                      <button
                        disabled={
                          busy ||
                          ["completed", "no_show", "cancelled"].includes(
                            v.status,
                          )
                        }
                      >
                        Update visit
                      </button>
                    </form>
                  </article>
                );
              })}
          {!(tab === "leads"
            ? data.enquiries?.length
            : data.visits?.length) && (
            <p className="note">No requests on this page.</p>
          )}
          <Pager
            offset={pageOffset}
            total={tab === "leads" ? data.enquiriesTotal : data.visitsTotal}
            onChange={setPageOffset}
          />
        </>
      )}
      {tab === "imports" && (
        <>
          {can(user.role, "review") && (
            <>
              <h2>Preview before import</h2>
              <p>
                This import stages new identity drafts. It never publishes,
                changes an existing approved ID, or applies prices and
                availability. Use Inventory for those reviewed transactions.
              </p>
              <a href="/downloads/inventory-review-template.csv" download>
                Download the supplied review template ↓
              </a>
              {" · "}
              <a href="/downloads/identity-approval-template.csv" download>
                Download explicit approval template ↓
              </a>
              <p className="small">
                Use the supplied sheet as evidence. Add an approvedBlock column
                or use the approval template; source plan references are never
                treated as approved block names.
              </p>
              <label>
                CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    if (e.target.files[0]) {
                      setCsv(await e.target.files[0].text());
                      setPreview(null);
                    }
                  }}
                />
              </label>
              <label>
                CSV content
                <textarea
                  rows="8"
                  value={csv}
                  onChange={(e) => {
                    setCsv(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <button
                disabled={busy || !csv}
                onClick={() =>
                  run(
                    async () =>
                      setPreview(
                        await mutate("/admin/imports/preview", { csv }),
                      ),
                    "Preview ready; inspect every error before committing.",
                  )
                }
              >
                Validate & preview
              </button>
              {preview && (
                <div className="note">
                  <p>
                    {preview.valid} valid / {preview.total} rows.{" "}
                    {preview.errors.length} errors.
                  </p>
                  {preview.errors.map((e) => (
                    <p key={e.row}>
                      Row {e.row}: {e.message}
                    </p>
                  ))}
                  <details>
                    <summary>Review staged values</summary>
                    <pre>{JSON.stringify(preview.rows, null, 2)}</pre>
                  </details>
                  <button
                    disabled={busy || !!preview.errors.length || !preview.valid}
                    onClick={() =>
                      run(async () => {
                        await mutate(
                          "/admin/imports/commit",
                          {
                            previewId: preview.id,
                          },
                          "POST",
                          importKey(preview.id),
                        );
                        setPreview(null);
                      }, "Import committed as drafts. Existing identities were preserved.")
                    }
                  >
                    Commit validated drafts
                  </button>
                </div>
              )}
            </>
          )}
          {can(user.role, "inventory") && (
            <section className="admin-card">
              <h2>Update reviewed inventory by CSV</h2>
              <p>
                Use current approved IDs and versions. Each row needs a reason.
                Changes apply together or none apply; blank fields leave values
                unchanged.
              </p>
              <a href="/downloads/inventory-update-template.csv" download>
                Download inventory update template ↓
              </a>
              {" · "}
              <a href="/api/admin/inventory-imports/template" download>
                Download current IDs and versions ↓
              </a>
              <label>
                Inventory CSV file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={async (e) => {
                    if (e.target.files[0]) {
                      setInventoryCsv(await e.target.files[0].text());
                      setInventoryPreview(null);
                    }
                  }}
                />
              </label>
              <label>
                Inventory CSV content
                <textarea
                  rows="6"
                  value={inventoryCsv}
                  onChange={(e) => {
                    setInventoryCsv(e.target.value);
                    setInventoryPreview(null);
                  }}
                />
              </label>
              <button
                disabled={busy || !inventoryCsv}
                onClick={() =>
                  run(
                    async () =>
                      setInventoryPreview(
                        await mutate("/admin/inventory-imports/preview", {
                          csv: inventoryCsv,
                        }),
                      ),
                    "Inventory preview ready.",
                    false,
                  )
                }
              >
                Preview inventory changes
              </button>
              {inventoryPreview && (
                <div className="note">
                  <p>
                    {inventoryPreview.valid} valid / {inventoryPreview.total}{" "}
                    rows · {inventoryPreview.errors.length} errors.
                  </p>
                  {inventoryPreview.errors.map((e) => (
                    <p key={e.row}>
                      Row {e.row}: {e.message}
                    </p>
                  ))}
                  <details>
                    <summary>Review current and proposed values</summary>
                    <pre>{JSON.stringify(inventoryPreview.rows, null, 2)}</pre>
                  </details>
                  <button
                    disabled={
                      busy ||
                      !!inventoryPreview.errors.length ||
                      !inventoryPreview.valid
                    }
                    onClick={() =>
                      run(
                        async () => {
                          await mutate(
                            "/admin/inventory-imports/commit",
                            { previewId: inventoryPreview.id },
                            "POST",
                            importKey(inventoryPreview.id),
                          );
                          setInventoryPreview(null);
                        },
                        "Inventory updates committed and audited.",
                        false,
                      )
                    }
                  >
                    Commit inventory changes
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
      {tab === "geometry" && (
        <>
          <h2>Reviewed geometry reassignment</h2>
          <details className="admin-card">
            <summary>Stage a split / merge geometry revision</summary>
            <p>
              Upload reviewed Polygon coordinates with sourceDocument,
              sourceRevision, reason and features. The data contract and example
              are in the reconciliation guide. Coordinates must be closed,
              non-self-crossing polygons in the source region. Every new cell
              remains review-required.
            </p>
            <label>
              Revision JSON file
              <input
                type="file"
                accept=".json,.geojson"
                onChange={async (e) => {
                  if (e.target.files[0])
                    setGeometryInput(await e.target.files[0].text());
                }}
              />
            </label>
            <label>
              Revision JSON
              <textarea
                rows="8"
                value={geometryInput}
                onChange={(e) => setGeometryInput(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !geometryInput}
              onClick={() =>
                run(async () => {
                  const r = await mutate(
                    "/admin/geometry-revisions",
                    JSON.parse(geometryInput),
                  );
                  downloadJSON(r, "staged-geometry-review.json");
                }, "Geometry staged for review. No existing mappings changed.")
              }
            >
              Validate & stage revision
            </button>
          </details>
          <p>
            Propose a replacement source cell for an immutable plot ID. Owner
            approval unpublishes it and clears measurement verification for
            re-review. Undo uses a new proposal back to the old geometry ID in
            the audit history. Prepare split or merged polygons as GeoJSON,
            stage them below, and inspect each new draft before mapping it. No
            existing geometry is overwritten.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(
                () =>
                  mutate("/admin/geometry-proposals", {
                    plotId: f.get("plotId"),
                    draftId: f.get("draftId"),
                    expectedVersion: Number(f.get("version")),
                    reason: f.get("reason"),
                  }),
                "Geometry proposal staged.",
              );
            }}
          >
            <div className="form-grid">
              <label>
                Approved plot ID
                <input name="plotId" required />
              </label>
              <label>
                Replacement draft geometry ID
                <input name="draftId" required />
              </label>
              <label>
                Current plot version
                <input name="version" type="number" min="1" required />
              </label>
            </div>
            <label>
              Evidence and reason
              <textarea name="reason" minLength={8} required />
            </label>
            <button disabled={busy}>Create proposal</button>
          </form>
          {data.proposals?.map((p) => (
            <article className="admin-card" key={p.id}>
              <p>
                {p.plot_id} → {p.draft_id} · {p.status}
              </p>
              <p>{p.reason}</p>
              {p.status === "pending" && can(user.role, "publish") && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(
                      () =>
                        mutate(`/admin/geometry-proposals/${p.id}/decide`, {
                          approve: f.get("decision") === "approve",
                          reason: f.get("reason"),
                        }),
                      "Proposal decision saved.",
                    );
                  }}
                >
                  <label>
                    Decision
                    <select name="decision">
                      <option value="reject">Reject</option>
                      <option value="approve">
                        Approve and return plot to draft
                      </option>
                    </select>
                  </label>
                  <label>
                    Decision reason
                    <input name="reason" required minLength={8} />
                  </label>
                  <button disabled={busy}>Record decision</button>
                </form>
              )}
            </article>
          ))}
        </>
      )}
      {tab === "content" && (
        <>
          <h2>Content & amenities</h2>
          <p>
            Edits save as drafts. Only an owner/administrator can publish
            verified content. Images remain private until published; use only
            media you have permission to share.
          </p>
          <div className="note">
            <p>
              The supplied concept locations, the shared temple/garden visual,
              and the four separately adjustable roundabout gardens can be
              staged as approximate private drafts. Existing records with the
              same IDs are never overwritten.
            </p>
            <button
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    mutate("/admin/amenity-references/stage", {
                      reason:
                        "Stage owner-indicated amenity references for review",
                    }),
                  "Owner-indicated references staged; existing records were preserved.",
                )
              }
            >
              Stage owner-indicated amenities
            </button>
          </div>
          {(data.items || [])
            .filter((item) => item.kind !== "presentation")
            .map((item) => (
              <ContentEditor
                key={`${item.id}-${item.version}`}
                item={item}
                run={run}
                mutate={mutate}
                user={user}
                busy={busy}
              />
            ))}
          <ContentEditor
            key="new-content"
            item={{
              id: "",
              kind: "amenity",
              version: 0,
              draft: {
                title: "",
                description: "",
                state: "confirmation_pending",
                source: "",
                verifiedAt: null,
              },
            }}
            run={run}
            mutate={mutate}
            user={user}
            busy={busy}
          />
        </>
      )}
      {tab === "presentation" && data.plots && (
        <PresentationEditor
          key={data.item?.version || 0}
          item={data.item}
          plots={data.plots}
          user={user}
          busy={busy}
          run={run}
          mutate={mutate}
        />
      )}
      {tab === "access" && (
        <>
          <h2>Staff access</h2>
          <p>
            Only owners can create or change staff access. Deactivation and role
            changes revoke active sessions.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(
                () => mutate("/admin/users", Object.fromEntries(f)),
                "Staff account created.",
              );
            }}
          >
            <div className="form-grid">
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                Email
                <input name="email" type="email" required />
              </label>
              <label>
                Initial password (14+ characters)
                <input
                  name="password"
                  type="password"
                  minLength={14}
                  required
                  autoComplete="new-password"
                />
              </label>
              <label>
                Role
                <select name="role">
                  {roles.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <button disabled={busy}>Create staff account</button>
          </form>
          {data.users?.map((u) => (
            <article
              className="admin-card"
              key={`${u.id}-${u.role}-${u.active}`}
            >
              <h3>
                {u.name} · {u.email}
              </h3>
              <p className="code-text">{u.id}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  run(
                    () =>
                      mutate(
                        `/admin/users/${u.id}`,
                        {
                          role: f.get("role"),
                          active: f.get("active") === "on",
                          reason: f.get("reason"),
                        },
                        "PATCH",
                      ),
                    "Staff access updated.",
                  );
                }}
              >
                <label>
                  Role
                  <select name="role" defaultValue={u.role}>
                    {roles.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={u.active}
                  />{" "}
                  Active account
                </label>
                <label>
                  Reason
                  <input name="reason" required minLength={8} />
                </label>
                <button disabled={busy || u.id === user.id}>Save access</button>
              </form>
              {u.id !== user.id && (
                <details>
                  <summary>Reset staff password</summary>
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget,
                        f = new FormData(form);
                      const result = await run(
                        () =>
                          mutate(`/admin/users/${u.id}/reset-password`, {
                            newPassword: f.get("newPassword"),
                            reason: f.get("resetReason"),
                          }),
                        "Password reset; existing sessions revoked.",
                      );
                      if (result) form.reset();
                    }}
                  >
                    <label>
                      New staff password (14+ characters)
                      <input
                        type="password"
                        name="newPassword"
                        minLength={14}
                        autoComplete="new-password"
                        required
                      />
                    </label>
                    <label>
                      Reason for password reset
                      <input name="resetReason" minLength={8} required />
                    </label>
                    <button disabled={busy}>Reset password</button>
                  </form>
                </details>
              )}
            </article>
          ))}
        </>
      )}
      {tab === "account" && (
        <section>
          <h2>Change your password</h2>
          <p>Changing your password signs out all your sessions.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(
                async () => {
                  await mutate("/admin/password", {
                    currentPassword: f.get("current"),
                    newPassword: f.get("new"),
                  });
                  setUser(null);
                },
                "Password changed. Sign in again.",
                false,
              );
            }}
          >
            <label>
              Current password
              <input
                type="password"
                name="current"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              New password (at least 14 characters)
              <input
                type="password"
                name="new"
                autoComplete="new-password"
                minLength={14}
                required
              />
            </label>
            <button disabled={busy}>Change password</button>
          </form>
        </section>
      )}
      {tab === "audit" && (
        <>
          <h2>Append-only audit history</h2>
          <p>
            Includes actor, timestamp, old/new business values and reason.
            History cannot be edited or deleted through the application.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setPageOffset(0);
              setAuditFilter(
                new FormData(e.currentTarget).get("entity").trim(),
              );
            }}
          >
            <label>
              Filter by entity ID
              <input name="entity" defaultValue={auditFilter} />
            </label>
            <button>Filter history</button>
          </form>
          {data.events?.map((e) => (
            <details className="audit-event" key={e.id}>
              <summary>
                {e.action} · {e.actor_name || "Public request"} ·{" "}
                {new Date(e.created_at).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}{" "}
                IST
              </summary>
              <p>{e.reason}</p>
              <p className="code-text">Entity: {e.entity_id}</p>
              <div className="form-grid">
                <div>
                  Before<pre>{JSON.stringify(e.old_value, null, 2)}</pre>
                </div>
                <div>
                  After<pre>{JSON.stringify(e.new_value, null, 2)}</pre>
                </div>
              </div>
            </details>
          ))}
          <Pager
            offset={pageOffset}
            total={data.total}
            onChange={setPageOffset}
          />
        </>
      )}
    </>
  );
}
function ContentEditor({ item, run, mutate, user, busy }) {
  const [kind, setKind] = useState(item.kind),
    [draft, setDraft] = useState(() =>
      item.kind === "amenity"
        ? {
            titleHi: "",
            descriptionHi: "",
            category: "other",
            location: null,
            customerVisible: true,
            imageUrl: "",
            imageKind: "illustration",
            placementPrecision: "approximate",
            visualScale: 1,
            visualRotation: 0,
            ...item.draft,
          }
        : item.kind === "site_access"
          ? { headingDegrees: null, ...item.draft }
          : item.kind === "nearby"
            ? { category: "", ...item.draft }
            : item.draft,
    ),
    [id, setId] = useState(item.id),
    [version, setVersion] = useState(item.version),
    [imageFile, setImageFile] = useState(null),
    [showPicker, setShowPicker] = useState(false);
  const templates = {
    structure: {
      title: "",
      footprint: { datum: "WGS84", outer: [], holes: [], source: "", sourceRevision: "" },
      frame: { physicalAnchor: { lat: null, lon: null }, headingDegrees: null, modelAxes: "right-up-forward", worldAxes: "east-up-south", units: "metres", pivot: [0, 0, 0] },
      height: null,
      model: null,
      verifiedAt: null,
      customerVisible: false,
    },
    site_access: {
      title: "Visitor entrance",
      routeAccess: null,
      physicalAnchor: null,
      headingDegrees: null,
      state: "confirmation_pending",
      source: "",
      sourceRevision: "",
      verifiedAt: null,
      customerVisible: false,
    },
    setting: {
      name: "Shubh Mangal Residency",
      tagline: "",
      contactPhone: "",
      contactEmail: "",
      entrance: null,
      verified: false,
      source: "",
    },
    amenity: {
      title: "",
      titleHi: "",
      description: "",
      descriptionHi: "",
      category: "other",
      location: null,
      customerVisible: true,
      imageUrl: "",
      imageKind: "illustration",
      placementPrecision: "approximate",
      visualScale: 1,
      visualRotation: 0,
      state: "confirmation_pending",
      source: "",
      verifiedAt: null,
    },
    media: {
      title: "",
      description: "",
      url: "",
      category: "document",
      revision: "",
      source: "",
      verifiedAt: null,
    },
    nearby: {
      title: "",
      category: "",
      lat: null,
      lon: null,
      distanceKm: null,
      method: "straight_line",
      source: "",
      verifiedAt: null,
    },
  };
  const choices = {
    state: ["confirmation_pending", "planned", "in_progress", "existing"],
    category:
      kind === "amenity"
        ? ["temple", "clubhouse", "garden", "fountain", "entrance", "other"]
        : kind === "media"
          ? ["document", "photography", "progress", "concept"]
          : null,
    imageKind: ["photograph", "concept", "illustration"],
    placementPrecision: ["approximate", "surveyed"],
    method: ["straight_line", "road_route"],
  };
  const imagePreview = kind === "amenity" ? draft.imageUrl : draft.url;
  return (
    <details className="admin-card">
      <summary>
        {item.id || "Add content"} · {item.published ? "Published" : "Draft"}
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run(
            () =>
              mutate(
                `/admin/content/${id}`,
                {
                  kind,
                  data: draft,
                  expectedVersion: version,
                  publish: f.get("publish") === "on",
                  reason: f.get("reason"),
                },
                "PUT",
              ),
            "Content saved.",
          );
        }}
      >
        <label>
          Content ID
          <input
            required
            disabled={!!item.id || kind === "site_access"}
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </label>
        {!item.id && (
          <label>
            Kind
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setDraft(templates[e.target.value]);
                setId(
                  e.target.value === "site_access"
                    ? "visitor-entrance"
                    : kind === "site_access"
                      ? ""
                      : id,
                );
              }}
            >
              {Object.keys(templates).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        {kind === "site_access" && (
          <>
            <p className="small">Publication requires existing status, a reviewed source and revision, a review date, and route access coordinates. Physical anchor and heading are optional.</p>
            <FootprintReview item={item} busy={busy} onStage={async (footprint, reason) => {
              const result = await run(
                async () => {
                  try {
                    return await mutate("/admin/content/visitor-entrance/footprint", { footprint, expectedVersion: version, reason }, "PUT");
                  } catch (error) {
                    if (error.status === 409) throw Error("The saved content changed elsewhere. Your local edits are still here; copy the footprint and any access edits before reloading to reconcile them.", { cause: error });
                    throw error;
                  }
                },
                "Footprint staged privately. Review road crossings and the saved draft before publishing.",
                false,
              );
              if (result) {
                setVersion(result.version);
                setDraft((current) => ({ ...current, footprint: result.draft.footprint }));
              }
              return result;
            }} />
          </>
        )}
        {kind === "structure" && <StructureFields value={draft} onChange={setDraft} />}
        {kind === "structure" && item.published && can(user.role, "publish") && (
          <button type="button" disabled={busy} onClick={(event) => {
            const reason = event.currentTarget.form.elements.reason.value;
            run(() => mutate(`/admin/content/${id}/unpublish`, { expectedVersion: version, reason }), "Structure unpublished; the draft and history remain available.");
          }}>Unpublish structure</button>
        )}
        <div className="form-grid">
          {Object.entries(draft)
            .filter(([key]) => key !== "footprint" && !(kind === "structure" && ["frame", "height", "model"].includes(key)))
            .map(([key, value]) =>
              [
                "entrance",
                "location",
                "routeAccess",
                "physicalAnchor",
              ].includes(key) ? (
                <div key={key}>
                  <label>
                    {
                      {
                        entrance: "Entrance",
                        location: "Amenity",
                        routeAccess: "Route access",
                        physicalAnchor: "Physical anchor",
                      }[key]
                    }{" "}
                    latitude (confirm before publishing)
                    <input
                      type="number"
                      step="any"
                      value={value?.lat ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [key]: e.target.value
                            ? {
                                lat: Number(e.target.value),
                                lon: d[key]?.lon ?? null,
                              }
                            : d[key]?.lon != null
                              ? { lat: null, lon: d[key].lon }
                              : null,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {
                      {
                        entrance: "Entrance",
                        location: "Amenity",
                        routeAccess: "Route access",
                        physicalAnchor: "Physical anchor",
                      }[key]
                    }{" "}
                    longitude
                    <input
                      type="number"
                      step="any"
                      value={value?.lon ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          [key]: e.target.value
                            ? {
                                lat: d[key]?.lat ?? null,
                                lon: Number(e.target.value),
                              }
                            : d[key]?.lat != null
                              ? { lat: d[key].lat, lon: null }
                              : null,
                        }))
                      }
                    />
                  </label>
                  {key === "location" && (
                    <>
                      <button
                        type="button"
                        onClick={() => setShowPicker(!showPicker)}
                      >
                        {showPicker
                          ? "Close position picker"
                          : "Adjust position on plan"}
                      </button>
                      {showPicker && (
                        <Suspense
                          fallback={<p role="status">Loading the plan…</p>}
                        >
                          <MapPositionEditor
                            referenceId={id}
                            location={value}
                            imageUrl={draft.imageUrl}
                            visualScale={draft.visualScale}
                            visualRotation={draft.visualRotation}
                            onChange={(location) =>
                              setDraft((d) => ({ ...d, location }))
                            }
                          />
                        </Suspense>
                      )}
                    </>
                  )}
                </div>
              ) : typeof value === "boolean" ? (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) =>
                      setDraft({ ...draft, [key]: e.target.checked })
                    }
                  />
                  {key === "customerVisible"
                    ? "Visible to customers after publication"
                    : key}
                </label>
              ) : (
                <label key={key}>
                  {{
                    title: "Name (English)",
                    titleHi: "Name (Hindi)",
                    description: "Description",
                    category: "Category",
                    state: "Status",
                    source: "Source",
                    sourceRevision: "Source revision / date (required)",
                    verifiedAt: "Last reviewed (ISO date/time)",
                    headingDegrees:
                      "Heading (degrees clockwise from north, optional)",
                    imageUrl: "Image path",
                    imageKind: "Image type",
                    placementPrecision: "Location precision",
                    visualScale: "Marker scale",
                    visualRotation: "Marker rotation (degrees)",
                  }[key] || key}
                  {choices[key] ? (
                    <select
                      value={value}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                    >
                      {choices[key].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={value ?? ""}
                      type={
                        typeof value === "number" ||
                        ["lat", "lon", "distanceKm", "headingDegrees"].includes(
                          key,
                        )
                          ? "number"
                          : "text"
                      }
                      step="any"
                      min={key === "headingDegrees" ? 0 : undefined}
                      placeholder={
                        key === "verifiedAt"
                          ? "ISO date/time, e.g. YYYY-MM-DDT00:00:00Z"
                          : ""
                      }
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [key]:
                            typeof value === "number" ||
                            [
                              "lat",
                              "lon",
                              "distanceKm",
                              "headingDegrees",
                            ].includes(key)
                              ? e.target.value === ""
                                ? null
                                : Number(e.target.value)
                              : key === "verifiedAt"
                                ? e.target.value || null
                                : e.target.value,
                        })
                      }
                    />
                  )}
                </label>
              ),
            )}
        </div>
        {(kind === "amenity" || kind === "media") && (
          <div className="note">
            {/\.(?:png|jpe?g|webp)$/i.test(imagePreview || "") && (
              <img
                className="admin-media-preview"
                src={imagePreview.replace(
                  "/api/public/media/",
                  "/api/admin/media/",
                )}
                alt="Image staged for owner review"
              />
            )}
            <label>
              Replace image (PNG, JPEG or WebP, up to 2 MB)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !imageFile}
              onClick={async () => {
                const staged = await run(
                  async () => {
                    const response = await fetch("/api/admin/media", {
                      method: "POST",
                      credentials: "same-origin",
                      headers: {
                        "Content-Type": imageFile.type,
                        "X-CSRF-Token": user.csrf,
                      },
                      body: imageFile,
                    });
                    const result = await response.json();
                    if (!response.ok)
                      throw Error(result.error || "Image upload failed");
                    return result;
                  },
                  "Image staged privately. Save this content, then publish after review.",
                  false,
                );
                if (staged)
                  setDraft((value) => ({
                    ...value,
                    [kind === "amenity" ? "imageUrl" : "url"]: staged.url,
                  }));
              }}
            >
              Stage image
            </button>
            <p className="small">
              A concept or illustration must be labelled; publication requires
              an owner-reviewed source and date.
            </p>
          </div>
        )}
        {can(user.role, "publish") && (
          <label className="check">
            <input name="publish" type="checkbox" /> Publish after evidence
            verification
          </label>
        )}
        <label>
          Reason
          <input name="reason" minLength={8} required />
        </label>
        <button disabled={busy}>Save content</button>
      </form>
    </details>
  );
}
