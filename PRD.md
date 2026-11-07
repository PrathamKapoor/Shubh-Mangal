# Product Requirements Document: Shubh Mangal Residency

**Document date:** 7 November 2026  
**Product:** Customer colony explorer and owner workspace  
**Status:** Working local application; colony information and launch decisions require owner review.  
**Companion:** [Project layout and architecture](PROJECT_LAYOUT.md)

This document describes the existing project, its intended product behaviour and the decisions still needed. “Implemented” means present in the inspected code and documentation; it does not mean a feature has been deployed or its business data verified. Previous test results are recorded in [the 3D implementation review](docs/3D_MASTER_IMPLEMENTATION.md); they were not rerun solely to write this document.

## 1. Product summary

Shubh Mangal Residency is a real-estate website centred on an interactive colony explorer. Visitors can explore the source drawing and illustrative 2D/3D presentations, find a plot, inspect the information supported by the data, shortlist or compare plots, and request contact or a visit. Authorised staff can reconcile source geometry with reviewed plot records, manage inventory and content, and follow up on enquiries and visits.

The product must be easy to use on phones and computers, visually trustworthy, and explicit about what is verified, approximate, unverified or awaiting review. An illustration does not establish a plot's legal dimensions, availability, facility completion or ownership.

## 2. Problem, audience and goals

**Problem:** A static colony plan is difficult for visitors to navigate, and source drawings alone do not provide verified live inventory or legal dimensions. Staff also need a controlled way to reconcile those sources and handle customer requests.

| Audience | Need |
| --- | --- |
| Prospective buyer or family member | Understand the layout, find a plot and its known information, compare choices and contact the team. |
| Owner or administrator | Review identity, geometry, content and inventory; publish only approved information; inspect the audit trail. |
| Sales staff | Review enquiries and visits and manage permitted inventory changes with an auditable reason. |
| Data reviewer | Reconcile draft cells, plot identities, dimensions and source evidence without automatically publishing. |
| Content editor | Stage amenity, presentation and media changes for authorised review and publication. |
| Read-only viewer | Inspect permitted internal information without making changes. |

**Product goals:** Make plot exploration understandable; preserve one identity across map, search, comparison and enquiry; distinguish source estimates from verified facts; give staff a secure, traceable review process; and work on desktop and mobile.

**Success measures to agree with the owner:** successful plot-finding and enquiry completion, visit requests needing follow-up, time to reconcile a plot, accessibility and performance on target devices, and the percentage of inventory reviewed. No target, baseline or commercial result is asserted yet.

## 3. Current source and publication state

A read-only inspection on 7 November 2026 found 556 reconstructed draft cells in `public/data/layout.json`; all have unverified status. Thirty-two have an additional identity-review flag, and 52 candidate labels are B-series labels. The source data and audit describe 524 cells with a single within-source-area label match. A single match is still a candidate, not an approved identity. KML names such as `PLOT n` identify source areas and are not automatically approved block names.

The running local API reported `local-demo` with zero published plots at inspection time. This is a snapshot of the local environment, not a statement about current real-world sales. The north-oriented PDF was selected as the owner review reference, subject to individual review. The KML, PDF, poster, GeoJSON and generated drawings do not by themselves verify legal boundaries, dimensions, availability or approvals.

The fountain, temple, play garden, clubhouse, entrance and four roundabout gardens are illustrative owner-indicated references. The swimming pool and outdoor gym are **proposed concepts**; their position, design and construction status need confirmation. No verified prices, legal dimensions, public contacts, completed amenities or approvals should be inferred from the reference assets.

## 4. Scope and functional requirements

### 4.1 Customer website and navigation

**Implemented:** Home, explorer, plot detail, compare, location, amenities, gallery/documents, contact, privacy and owner routes. The site uses an emerald, ivory and gold identity, responsive navigation, English/Hindi interface support and a guided sequence. Full Hindi content still needs owner review.

**Requirements:**

- Visitors can reach the explorer, location, source plans, amenities and contact/visit flows from the site navigation.
- Marketing and facility statements use reviewed content. Unverified source claims remain labelled and must not imply an approval, completed utility, price or legal guarantee.
- Layouts and controls work at common desktop, tablet and phone sizes, with clear text and touch targets.

### 4.2 Colony exploration

**Implemented:** Illustrated Colony, 3D Colony, 2D plan/source drawing and Original Plan views, with a shared plot selection and list/search experience. The 3D code loads on demand and offers a 2D fallback if it cannot run.

**Requirements:**

- The source drawing and original document remain available; illustrated views disclose that they are concepts and not to scale.
- The 2D map supports pan, pinch/zoom, reset, selection, readable zoom-aware labels, layer controls, fullscreen where supported and an accessible plot list. The original document is displayed separately, without speculative interactive plot boundaries.
- The 3D scene uses existing presentation/source paths and record IDs, supports orbit, tilt, zoom, top view, reset, focus and layer controls, and provides a usable 2D fallback. On touch devices, the visitor can enable map touch controls and return to normal page scrolling.
- The lower-left approach, B-series candidate columns, fountain, temple/play garden, clubhouse, pool/gym concepts and entrance should retain their source/owner-indicated relationships. Their apparent construction and exact positions remain illustrative until reviewed.
- Labels must remain readable at useful zoom levels. A selected plot is identifiable independently of its status. Accessible list/search alternatives remain available.

**Known limitations:** The 3D scene uses simple procedural models rather than surveyed or photorealistic models. It omits unsupported curved path commands rather than inventing geometry. The owner preview for unpublished placement changes is in 2D; extreme changes to a 3D amenity's position or scale may overlap a road or plot and require manual review. Physical-device and GPU performance remain to be checked.

### 4.3 Plot identity, search and details

**Implemented:** Plot search and filters, source-label/demo handling, approved block navigation when published memberships exist, URL restoration and history, shared selection, detail panels, unit conversion, shortlist and comparison.

**Requirements:**

- A selection resolves to the same permitted record from the map, list, search, URL, 3D scene and enquiry flow. Ambiguous or unpublished records are not silently mapped to another plot.
- Show an approved number and block only when supplied through the reviewed inventory. Candidate source labels and unresolved identities must remain clearly identified as such.
- Show availability as verified available, reserved, sold, blocked where relevant, or unverified, using text as well as colour. An enquiry, a selection or a visit request is not a booking.
- Show verified measurements with their provenance when available. Label geometry-derived area and sides “Approx.” or “Map-derived”; do not invent missing area, dimensions, facing, road width, price or plot type. Feet/metres and area-unit conversions must preserve the source value.
- The shortlist is local to the browser. Comparison supports up to three records and must identify unavailable or missing values rather than treating them as verified.

### 4.4 Amenities and source documents

**Implemented:** Amenity navigation and cards, individual owner-indicated references, 2D concept artwork, procedural 3D forms, separate pool/gym entries, the supplied source plan and separate marketing reference.

**Requirements:**

- Only show published, customer-visible amenities in connected public mode. Local/demo mode may show clearly identified reference previews.
- Show facility name, owner-reviewed description and status; label images and models as illustrative where applicable. The pool and gym begin as proposed, not completed.
- Allow authorised staff to stage and review amenity position, scale, rotation, content, status, image and visibility; record changes through the existing publication/audit workflow.
- Keep the original KML, PDF and reference imagery intact. The poster, generated masterplan and concept images are references, not survey or construction evidence.

### 4.5 Enquiries and visits

**Implemented:** General and plot-context enquiries, visit requests, validation, consent, server persistence when configured, retry idempotency, failure handling and owner-side review.

**Requirements:**

- Validate customer name, phone, consent and the fields applicable to the requested contact method or visit. Allow optional email/message where appropriate. Use Asia/Kolkata for visit scheduling.
- Preserve the selected plot's identity in a plot-specific request. No customer contact data belongs in a public share URL.
- Show success only after a configured backend accepts and persists the request. With no backend, provide an explicitly unsent local draft; in local API mode, explain that no notification was sent.
- A visit begins as requested. Staff may contact, confirm, reschedule, complete, mark no-show or cancel according to the server's permitted transitions. A request is not an appointment confirmation.

### 4.6 Owner and data-review workspace

**Implemented:** Authenticated `/admin` workspace with inventory/data review, content and amenity editing, presentation placements, enquiries, visits, CSV previews, geometry revisions, staff roles and audit access.

**Requirements:**

- Reconcile each draft cell against owner-reviewed evidence before assigning an immutable approved plot ID, number and approved block. Preserve source revision, ambiguity flags and provenance.
- Keep draft, reviewed and published states distinct. Only authorised roles may publish or change inventory. Display prices publicly only when reviewed and explicitly enabled.
- Use server-side permissions, version checks and transactions for sensitive mutations; retain actor, timestamps, old/new values and reason in audit/history. Protect history from deletion.
- Stage imports and geometry revisions with validation and explicit review. Never regenerate or replace approved mappings silently. Preserve plot IDs and lead context through changes.
- Presentation placement is separate from measurements and inventory. Review layout overlaps, road access and neighbour relationships before publishing visual changes.

## 5. Data, safety and privacy rules

- Source drawing geometry is a reconstruction from KML and related materials; it is not a cadastral survey. Original data and derived measurements must retain provenance and review indicators.
- Never invent pricing, availability, plot dimensions, frontage, road widths, customer testimonials, approvals or completed facility claims.
- Customer contact information, staff notes, credentials and unpublished content remain private. Public APIs expose only permitted published records in connected mode.
- Authentication and authorisation are enforced server-side. The project has no default administrator password. Requests use validation, origin/CSRF checks, rate limits, idempotency where required and parameterised database queries.
- Do not reset or reseed an existing database. Back up before migrations and follow [deployment and recovery](docs/DEPLOYMENT.md).

## 6. Accessibility, performance and reliability

- Provide semantic controls, visible focus, accessible names, keyboard access, legible contrast, status text beyond colour, reduced-motion support and responsive layouts.
- Keep plot/amenity list alternatives when a visitor cannot use the canvas. On WebGL or asset failure, provide a useful 2D map and retain the selected record.
- Lazy-load the 3D scene; avoid unnecessary animation and large initial asset downloads. The documented build produced an approximately 1.10 MB minified 3D chunk (about 297 KB gzip); remeasure after relevant changes.
- Preserve entered form data on errors and clearly distinguish stale, loading, offline and retry states. Do not claim an external message was delivered without a configured integration.
- Browser-emulated mobile checks do not replace physical Android/iPhone testing.

## 7. Product acceptance criteria

1. A visitor can search for and select a permitted plot, switch between views, inspect the same identity and source-backed details, shortlist/compare it, and start an enquiry or visit request.
2. Availability is consistent across map, list, details and comparison; unverified plots are never presented as available. Selection uses a separate gold outline.
3. An amenity selection opens the matching details without leaving an unrelated plot's details or enquiry context active. Pool and gym are labelled proposed unless an authorised owner verifies their actual status.
4. An authorised reviewer can stage a plot or amenity change; publication requires the appropriate role and review. Changes retain history and do not silently overwrite source documents or real owner data.
5. Forms acknowledge only successful server acceptance; offline/local behaviour and the difference between requested and confirmed visits are clear.
6. The accessible plot list, keyboard controls, responsive layouts and 2D fallback remain usable when 3D is unavailable.
7. Relevant automated tests, browser review and production build pass for the release being evaluated; any failure or untested device is reported honestly.

## 8. Out of scope or not yet configured

Payments, booking/hold automation, a satellite basemap, live notification delivery, real-time sales guarantees, legal/approval verification, surveyed 3D models and cross-device shortlist synchronisation are not implemented. External services, hosting and public deployment require separate owner decisions and configuration. The project is not a substitute for legal or survey review.

## 9. Owner decisions and launch dependencies

- Reconcile all plot identities, approved blocks, ambiguous/missing labels and source conflicts against the selected reviewed plan.
- Verify dimensions, areas, frontage, facing, road widths, plot types, current availability and any publishable prices.
- Confirm the entrance/approach, amenity positions and status, including whether the proposed pool and gym will be built.
- Confirm rights to publish source documents and imagery; supply actual approved site media and factual marketing copy if desired.
- Provide confirmed contact details, privacy contact/retention rules, staff access and operational responsibilities.
- Decide domain, hosting, production PostgreSQL, backups/recovery and any notification provider. Test physical devices and security/operational readiness before public release.

## 10. Reference documents

- [Project layout and architecture](PROJECT_LAYOUT.md)
- [Data notes](docs/DATA_NOTES.md), [reconciliation guide](docs/RECONCILIATION.md) and [source audit](docs/DATA_AUDIT.json)
- [Owner and visitor workflow](docs/WORKFLOW.md), [API contract](docs/API.md) and [deployment guide](docs/DEPLOYMENT.md)
- [Visual asset inventory](docs/ASSET_INVENTORY.md) and [3D implementation review](docs/3D_MASTER_IMPLEMENTATION.md)
- [Original project brief](CODEX_MASTER_PROMPT.md) and [3D master prompt](SHUBH_MANGAL_3D_MASTER_PROMPT.md)
