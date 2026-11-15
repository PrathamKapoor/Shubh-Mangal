# API contract

API responses use Cache-Control: no-store. JSON requests are limited to 256 KB; authorised raster image uploads are limited to 2 MiB. Published image endpoints return image bytes; other endpoints return JSON or an authenticated CSV template. Production serves API and frontend on one HTTPS origin. PostgreSQL queries use bound parameters. There are no public lead-list endpoints.

## Authentication and mutations

`POST /api/auth/login` accepts `{email,password}` and requires Origin equal to APP_ORIGIN. Returns `{id,name,role,csrf}` and an HttpOnly SameSite=Strict cookie scoped to `/api`; Secure in production. The database holds only a session token hash. `GET /api/auth/session` restores the signed-in staff user/CSRF token. Session expiry is eight hours.

All staff mutations require the session cookie, matching Origin and X-CSRF-Token. Most important mutations additionally require `Idempotency-Key` (16–100 alphanumeric/hyphen characters). Identical retries return the prior result; a different body under the same scope/key returns 409. Requests use transaction-scoped advisory locks plus a unique idempotency table key. Public forms also require Origin and Idempotency-Key.

Use a new key for intentionally changed payloads. Public form clients retain a key across failed retries without clearing input. Do not place contact details or authentication tokens in URLs.

Errors: `{error, fields?, requestId}`. Validation errors are 422; unauthenticated 401; forbidden/CSRF/origin 403; missing or unpublished 404; stale versions/uniqueness/idempotency conflicts 409; rate limits 429; unexpected server failures 500 with no internal details. Fields maps schema paths to helpful messages. SQL errors are never returned with customer values. Success status is 200 or 201; no frontend-only success is shown.

## Public endpoints

| Endpoint                    | Result / request                                                                                                                                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/health             | `{ok, mode, storage}`; probes database                                                                                                                                                                                                                              |
| GET /api/public/project     | `{mode, items:[{id,kind,published}]}`; only published content                                                                                                                                                                                                       |
| GET /api/public/plots       | `{plots,offset,limit,total,version,demo}`; only published approved records; limit 1–600, offset >=0. Optional `q`, `block`, `status`, `type`, `facing`, `phase`, `corner=yes\|no`, `minArea`, `maxArea`, `minRoad`, `maxPrice`; dimensions are in m²/m, prices INR. |
| GET /api/public/plots/:uuid | Exact published record or 404                                                                                                                                                                                                                                       |
| GET /api/public/geometry    | Approved public ID → geometry/revision mappings                                                                                                                                                                                                                     |
| GET /api/public/media/:name | Raster bytes only when referenced by visible, published content; otherwise 404                                                                                                                                                                                      |
| POST /api/enquiries         | Persistent enquiry; returns `{reference,status,mode,message}`                                                                                                                                                                                                       |
| POST /api/visit-requests    | Enquiry plus requested visit; returns `{reference,visitId,status:"requested",mode,message}`                                                                                                                                                                         |

The explorer fetches all pages (up to 600 per request), deduplicates IDs and filters the loaded records in the client. The supplied source contains 556 draft cells. Area filtering uses verified area when supplied and otherwise the labelled map-derived estimate. Price filtering only considers a price the owner made public. Public filters use parameterised queries; `version` describes the current page rather than a transactional snapshot across multiple requests.

Public plot projection contains approved UUID/number/block, status/version, record update time, separate `statusUpdatedAt` from status history, approved field values, verifiedAt, source revision, safe geometry, optional published price and explicit source-review indicators. Internal review notes, reviewer account IDs, passwords and private contacts are not exposed. Draft source data is separately and visibly illustrative.

Contact body:

```json
{
  "name": "Visitor name",
  "phone": "+91 ...",
  "email": "",
  "message": "",
  "consent": true,
  "language": "en",
  "preferredContact": "phone",
  "plotIds": [],
  "website": ""
}
```

Phone must contain 8–15 digits in the accepted telephone punctuation format. Email is optional unless `preferredContact` is `email`; accepted methods are `phone`, `whatsapp`, and `email`. This records a preference and does not send a message. Names/messages reject control characters/markup. `website` is an empty honeypot. Maximum three selected references. Production accepts published approved IDs only; demo mode permits known draft source IDs. The server records selection-time label/status/version context and consent time/version. Visit requests add preferredAt as a future ISO timestamp with timezone. All UI dates use Asia/Kolkata. Public form rate limit: 12 attempts per IP per 15 minutes; sign-in: 10. Buckets are stored in the database and use hashed IP-derived keys. No untrusted forwarded IP is accepted by default.

## Owner endpoints

| Endpoint                                        | Permission / contract                                                                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/admin/overview                         | Any staff; current role/mode                                                                                                                                                           |
| GET /api/admin/review                           | Review; all draft cells, source revision and current plot mapping                                                                                                                      |
| POST /api/admin/reconcile                       | Review; `{draftId,data}` → UUID draft record                                                                                                                                           |
| GET /api/admin/plots                            | Any staff; internal reconciled inventory                                                                                                                                               |
| PATCH /api/admin/plots/:uuid                    | Field-specific permission; versioned transactional update                                                                                                                              |
| GET /api/admin/enquiries                        | Leads permission; private enquiries and visits with `limit` 1–100 and `offset`; includes total counts, each visit's associated enquiry context and safe active staff names/IDs         |
| PATCH /api/admin/enquiries/:uuid                | Leads; expectedVersion, stage, notes, assignedTo UUID/null, nextActionAt ISO/null, reason                                                                                              |
| PATCH /api/admin/visits/:uuid                   | Leads; expectedVersion, status, scheduledAt ISO/null, reason                                                                                                                           |
| GET /api/admin/audit?entity=ID                  | Audit permission; paginated old/new events with `limit` 1–100 and `offset`, optionally one entity                                                                                      |
| GET /api/admin/export                           | Review; approved records/mappings, no lead data                                                                                                                                        |
| POST /api/admin/imports/preview                 | Review; `{csv}` → ID, row counts, staged values, row-specific errors                                                                                                                   |
| POST /api/admin/imports/commit                  | Same reviewer; `{previewId}` → atomic staged draft IDs                                                                                                                                 |
| GET /api/admin/inventory-imports/template       | Inventory permission; CSV with current non-archived UUIDs and versions, blank mutation fields                                                                                          |
| POST /api/admin/inventory-imports/preview       | Inventory permission; `{csv}` → row-specific errors and before/after values                                                                                                            |
| POST /api/admin/inventory-imports/commit        | Same actor; `{previewId}` → atomic, versioned and audited inventory batch                                                                                                              |
| POST /api/admin/geometry-revisions              | Review; source/reason/Polygon features → new review-required cells; see reconciliation guide                                                                                           |
| GET/POST /api/admin/geometry-proposals          | Review; list or propose `{plotId,draftId,expectedVersion,reason}`                                                                                                                      |
| POST /api/admin/geometry-proposals/:uuid/decide | Publish permission; `{approve,reason}`; mapping change clears verification and unpublishes                                                                                             |
| GET /api/admin/content                          | Content permission; draft/published content                                                                                                                                            |
| GET /api/admin/presentation                     | Content permission; presentation settings and plot-to-geometry mappings for review                                                                                                     |
| POST /api/admin/amenity-references/stage        | Content permission; authorised, idempotent staging of private owner-indicated approximate amenity and visual drafts. Existing IDs are skipped without edits; each creation is audited. |
| PUT /api/admin/content/:id                      | Content; `{kind,data,expectedVersion,publish,reason}`; publication additionally requires owner/admin and verification                                                                  |
| POST /api/admin/media                           | Content permission and CSRF; raw PNG/JPEG/WebP bytes, matching Content-Type, ≤2 MiB; returns a private staged URL. Rate limit 30/15 min.                                               |
| GET /api/admin/media/:name                      | Content permission; private staged image preview                                                                                                                                       |
| GET/POST /api/admin/users                       | Owner only; safe user listing / `{email,name,password,role}` creation                                                                                                                  |
| PATCH /api/admin/users/:uuid                    | Owner; `{role,active,reason}`; own-role changes are rejected                                                                                                                           |
| POST /api/admin/users/:uuid/reset-password      | Owner; `{newPassword,reason}`; revokes sessions, never audits plaintext/hash                                                                                                           |
| POST /api/admin/password                        | Any staff; `{currentPassword,newPassword}`; revokes all own sessions                                                                                                                   |
| POST /api/admin/logout                          | Any staff; revokes own sessions                                                                                                                                                        |

Approved evidence (`data`) schema: number, explicitly approved block, optional phase, nullable corner/parkFacing, optional `documentIds` of public content records, plotType (not_provided/residential/commercial/mixed), areaSqM nullable, areaSourceText, dimensions array of `{name,metres,sourceText,edgeIndex?}`, roadWidthMetres nullable, facing nullable (N/NE/E/SE/S/SW/W/NW), sourceDocument, sourceRevision and reviewNote. Only published document content is shown as a plot link. All schemas reject unknown keys. Evidence updates require review permission and return the record to draft. The identity CSV requires `approvedBlock`; a source plan-section name is not used as an approved block.

Published `visitor-entrance` in `GET /api/public/project` retains its existing public access fields. Its optional `footprint` contains only WGS84 `[longitude, latitude]` outer and hole rings. Footprint evidence and declared road/gate interactions remain in the private content record. Staging and publication reject positive-area overlap with current published mapped parcels; they do not check road or structure clearance.

Plot patch: `{expectedVersion, reason, data?, status?, publication?, priceINR?, priceVisible?}`. Reason requires at least eight characters. Status/price edits require inventory permission. Non-unverified status requires a previously reviewed identity. `reviewed` requires review permission; publish/archive/draft transitions require owner/admin. Publication requires the prior state reviewed; changing evidence and publishing in the same call cannot publish it. Visible price requires a non-null amount.

Roles are defined centrally in `shared/domain.mjs`. Exact field bounds and content contracts are in shared schemas and server/content.mjs. No audit/history DELETE or mutation endpoint exists. Database triggers reject update/delete of permanent history and deployment grants also revoke TRUNCATE.

Amenity content also accepts `descriptionHi`, `placementPrecision` (`approximate` or `surveyed`), `visualScale` (0.5–1.6) and `visualRotation` (-180–180 degrees); missing fields receive backwards-compatible defaults. For the reserved reference IDs the server rejects coordinates outside the corresponding owner-indicated plan areas. Published locations are projected into the same map coordinate frame; approximate does not mean survey-verified. Details and evidence limitations are in RECONCILIATION.md.

`PUT /api/admin/content/illustrated-layout` accepts `kind: "presentation"` and `{source, verifiedAt, placements}`. Each placement contains the existing approved `plotId` UUID, its current `geometryId`, `dx`/`dy` (-100 to 100), uniform `scale` (0.5 to 2), and `rotation` (-180° to 180°). The server validates uniqueness, current mapping and placement inside the scene, not containment within the original source polygon. Publication requires a previously saved unchanged draft, a review date, an owner/administrator and published plots. Overlaps, road clearance and neighbour relationships require manual review. Draft saves preserve the last published layout; mutations are version-checked, idempotent and audited. The public project response filters placements against currently published plot/geometry mappings, so an unpublished or remapped plot cannot silently inherit an old placement. No plot identity, measurement, status, price or source geometry is mutated.

## Deliberate limitations

API success means database acceptance, not notification delivery or a confirmed visit. `no_show` is a terminal visit outcome that requires the existing agreed slot and cannot be recorded for a future slot. No payment/hold/reservation API is implemented. No external account secrets, unrestricted personal exports, public uploads, 3D model uploads, or legal-certification endpoint exists. Staged raster assets require persistent private storage and separate backup; image format signatures are checked, but metadata is not stripped. MFA/SSO and notification integrations are follow-on operational work.

# Public geographic feature snapshot

`GET /api/public/geometry` retains `mappings` (`plot_id`, `draft_id`, `revision_id`) and adds `type: "FeatureCollection"`, `features` and `snapshot`. It is `Cache-Control: no-store`, like public inventory. One database statement reads published plots and their current mapped immutable geometry. An empty official inventory returns an empty collection; no draft source layer is substituted.

Each plot feature has its stable UUID as `id` and whitelisted properties: `featureType: "plot"`, `plotId`, `geometryId`, `revisionId`, `version`, `publication: "published"`, `status`, `provenance`. No price, private note or staff record is included. Consumers must match feature UUID, geometryId and version to their current inventory and suppress duplicate/mismatched IDs. A new `snapshot` is a digest of ordered public UUID/version/mapping tuples, not a survey revision or business approval. Revalidate on open/focus/60-second cadence; clear overlays if the fetch fails rather than showing a stale reassigned shape.

New staged revisions retain exact validated input WGS84 coordinates in immutable cell JSON. Older cells use an explicitly labelled compatibility conversion from their unchanged M/L/Z paths via layout metadata. Legacy exported paths are rounded to 0.001 m (at most approximately 0.00071 m vertex rounding displacement before inverse projection); this is numerical provenance, not field accuracy. Unsupported or invalid paths yield no feature. Holes and multipart paths survive conversion. The staging importer still accepts only a single closed outer ring and rejects holes/MultiPolygon inputs explicitly through schema validation. Road/site/amenity publication is not inferred from provisional source areas.
