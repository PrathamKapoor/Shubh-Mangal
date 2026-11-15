# Shubh Mangal Residency: Project Layout and Architecture

**Inventory date:** 7 November 2026  
**Purpose:** Explain what the product is, how its pieces connect and where its files live.  
**Companion:** [Product Requirements Document](PRD.md)

The project is one React/Vite website with a Node/Express API and an authenticated owner workspace. Its primary experience is an interactive colony explorer: visitors can use 2D source and illustrative views or an illustrative interactive 3D view, then inspect the same plot record, compare choices and submit an enquiry or visit request. Staff review source geometry and business information before publishing it.

This guide inventories the current source tree. It intentionally does not enumerate installed dependencies, build output, local databases, environment secrets, uploaded media, test artifacts or screenshot contents. [docs/ASSET_INVENTORY.md](docs/ASSET_INVENTORY.md) explains image origins and verification.

## 1. Website map

```text
/                    Home and introduction
/explore             Colony explorer: Illustrated Colony, 3D Colony,
                     2D plan (Source drawing), Original Plan, search/list
/plots/:id           Shareable approved plot detail and explorer context
/compare             Compare up to three plot selections
/location            Location reference and directions link
/amenities           Published amenities or explicitly labelled demo references
/gallery             Source and approved visual materials
/documents           Original/source documents and permitted public materials
/contact             General/plot enquiry and visit request
/privacy             Form-data handling information
/admin               Authenticated owner/staff workspace
```

`?plot=`, `?block=` and `?amenity=` support relevant explorer state. Approved plot IDs are distinct from provisional source cell identifiers. Not every source-area name is an approved block. See [README.md](README.md) and [docs/WORKFLOW.md](docs/WORKFLOW.md) for the exact behaviour and role permissions.

## 2. Main user journeys

```text
Visitor
  Home / Explore
    → Search or browse the accessible plot list
    → Select the same record in 2D, 3D or its shareable link
    → Read source-backed or reviewed details and units
    → Shortlist / compare → enquiry or visit request

Owner or authorised staff
  Sign in → Data review / Inventory / Content / Illustrated layout
    → Check source geometry, identity, evidence and changes
    → Save draft → review → publish where authorised
    → Audit history and customer-facing projection update
  Enquiries / Visits → contact and manage a requested or scheduled visit
```

A shortlist stays in the browser. A visit request is not automatically confirmed, and neither a request nor a map selection reserves a plot. In local demo mode the app clearly identifies reference data; connected public mode serves approved/published records.

## 3. System architecture

```text
Browser: React + Vite
  src/main.jsx, styles, components and services
      │
      ├── 2D SVG explorer and original document
      ├── lazy-loaded Three.js / React Three Fiber 3D scene
      └── forms, comparison and authenticated owner UI
      │
      ▼
Node.js / Express API: server/
  validation + authentication + role permissions + audit + transactions
      │
      ├── local development: persistent PGlite database (.local/database)
      └── production: PostgreSQL configured through environment variables
      │
      ├── public projection: published plot/content data only in connected mode
      ├── private enquiries, sessions, staged content and audit records
      └── private staged uploads: MEDIA_DIRECTORY (normally .local/media)

Source KML / PDF / imagery → source-data/ and supplied root images
  → scripts/ preparation and reconstruction → public/data/ + public/assets/
  → owner review and explicit approved plot-to-geometry mappings
```

`shared/domain.mjs` contains common domain rules and helpers. `shared/presentation.mjs` keeps optional visual placements separate from stored measurements. `shared/scene3d.mjs` maps projected drawing coordinates into 3D and handles supported line-path rings and holes. The 3D artwork is illustrative; source or approved records remain the source for dimensions and inventory.

## 4. Annotated source tree

The following tree expands all currently present, non-private project source and reference files. The three large concept attachments are preserved in `source-data/`; public derivatives are separate. Paths under `dist/`, `node_modules/`, `public/downloads/`, `.local/`, `reports/`, `test-results/` and `playwright-report/` are summarised in section 6 rather than expanded.

```text
Shubh_Mangal_Codex_Kit/
├── deploy/
│   ├── nginx.conf
│   ├── postgres-roles.sql
│   └── shubh-mangal.service
├── docs/
│   ├── 3D_MASTER_IMPLEMENTATION.md
│   ├── API.md
│   ├── ASSET_INVENTORY.md
│   ├── CHANGELOG_FILES.md
│   ├── DATA_AUDIT.json
│   ├── DATA_NOTES.md
│   ├── DELIVERY.md
│   ├── DEPLOYMENT.md
│   ├── FILE_MANIFEST.json
│   ├── identity-approval-template.csv
│   ├── IMAGE_GUIDE.md
│   ├── IMPLEMENTATION_AUDIT.md
│   ├── INTERACTION_REVIEW.md
│   ├── inventory-review-template.csv
│   ├── inventory-update-template.csv
│   ├── LEISURE_3D_REVIEW.md
│   ├── PRESENTATION_REVIEW.md
│   ├── RECONCILIATION.md
│   ├── REQUIREMENTS_AUDIT.md
│   ├── SCENE_REDESIGN_REVIEW.md
│   ├── source-annotations.csv
│   ├── TOPDOWN_REVIEW.md
│   └── WORKFLOW.md
├── public/
│   ├── assets/
│   │   ├── concepts/
│   │   │   ├── club-house-map.webp
│   │   │   ├── club-house.png
│   │   │   ├── clubhouse-foreground-map.webp
│   │   │   ├── clubhouse-foreground.png
│   │   │   ├── entry-gate-map.webp
│   │   │   ├── entry-gate-road-free-map.webp
│   │   │   ├── entry-gate-road-free.png
│   │   │   ├── entry-gate.png
│   │   │   ├── fountain-center-map.webp
│   │   │   ├── fountain-center.png
│   │   │   ├── fountain-corner-map.webp
│   │   │   ├── fountain-corner.png
│   │   │   ├── fountain-map.webp
│   │   │   ├── fountain.png
│   │   │   ├── garden-map.webp
│   │   │   ├── garden-temple-map.webp
│   │   │   ├── garden-temple.png
│   │   │   ├── garden.png
│   │   │   ├── houseclub-no-pool-map.webp
│   │   │   ├── houseclub-no-pool.png
│   │   │   ├── outdoor-gym-concept-map.webp
│   │   │   ├── outdoor-gym-concept.png
│   │   │   ├── playground-foreground-map.webp
│   │   │   ├── playground-foreground.png
│   │   │   ├── pool-concept-map.webp
│   │   │   ├── pool-concept.png
│   │   │   ├── temple-foreground-map.webp
│   │   │   ├── temple-foreground.png
│   │   │   ├── temple-map.webp
│   │   │   └── temple.png
│   │   ├── textures/
│   │   │   ├── plot-grass.webp
│   │   │   └── road-texture.webp
│   │   ├── colony-poster.png
│   │   ├── favicon.svg
│   │   ├── geographic-layout.png
│   │   ├── geographic-layout.svg
│   │   ├── plot-dimensions-example.png
│   │   └── survey-plan-north.png
│   └── data/
│       ├── layout.json
│       ├── reconstructed-cells.geojson
│       └── source-areas.geojson
├── scripts/
│   ├── data.test.mjs
│   ├── database.mjs
│   ├── manifest.mjs
│   ├── optimize_concepts.mjs
│   ├── optimize_map_assets.mjs
│   ├── prepare_data.py
│   ├── prepare_public.mjs
│   ├── render_assets.py
│   └── requirements.txt
├── server/
│   ├── migrations/
│   │   ├── 001_initial.sql
│   │   ├── 002_history_protection.sql
│   │   ├── 003_visit_no_show.sql
│   │   └── 004_presentation_content.sql
│   ├── app.mjs
│   ├── auth.mjs
│   ├── content.mjs
│   ├── db.mjs
│   ├── geometry.mjs
│   ├── inventory.mjs
│   ├── media.mjs
│   ├── seed.mjs
│   └── start.mjs
├── shared/
│   ├── domain.mjs
│   ├── owner-amenity-references.mjs
│   ├── presentation.mjs
│   └── scene3d.mjs
├── source-data/
│   ├── clubhouse-pool-gym-concept.png
│   ├── MAHENDRAR JI ALL PDF NORTH.pdf
│   ├── outdoor-gym-concept.png
│   ├── owner-masterplan-concept-2026-11-02.png
│   ├── pool-concept.png
│   └── Shubh_Mangal_Full_Layout.kml
├── src/
│   ├── components/
│   │   ├── Admin.jsx
│   │   ├── AmenityArtwork.jsx
│   │   ├── AmenityFigure.jsx
│   │   ├── Colony3D.jsx
│   │   ├── Compare.jsx
│   │   ├── ContactForm.jsx
│   │   ├── LeisureFacility.jsx
│   │   ├── MapCanvas.jsx
│   │   ├── MapPositionEditor.jsx
│   │   ├── PlotDetails.jsx
│   │   └── PresentationEditor.jsx
│   ├── services/
│   │   ├── amenities.js
│   │   └── api.js
│   ├── main.jsx
│   └── styles.css
├── tests/
│   ├── e2e/
│   │   ├── amenity-selection.spec.js
│   │   ├── colony-3d.spec.js
│   │   ├── explorer-layout.spec.js
│   │   ├── road-presentation.spec.js
│   │   ├── site.spec.js
│   │   └── three-integration.spec.js
│   ├── amenities.test.mjs
│   ├── api.test.mjs
│   ├── domain.test.mjs
│   ├── e2e-server.mjs
│   ├── persistence.test.mjs
│   ├── presentation.test.mjs
│   ├── scene3d.test.mjs
│   └── source-preservation.test.mjs
├── .env.example
├── .gitignore
├── club-house.png
├── CODEX_MASTER_PROMPT.md
├── entry--gate-new.png
├── entry-gate.png
├── eslint.config.js
├── fountain-center.png
├── fountain-corner.png
├── fountain.png
├── garden-temple.png
├── garden.png
├── geographic-layout.png
├── houseclub.png
├── index.html
├── package-lock.json
├── package.json
├── playwright.config.js
├── plot-dimensions-example.png
├── plot-grass.png
├── PRD.md
├── PROJECT_LAYOUT.md
├── README.md
├── road-lines.png
├── road-texture.png
├── shubh-mangal-masterplan-reference.png
├── SHUBH_MANGAL_3D_MASTER_PROMPT.md
├── Shubh_Mangal_Codex_Master_Prompt.md
├── temple.png
└── vite.config.js
```

## 5. What the main files do

| Location | Responsibility |
| --- | --- |
| `index.html`, `vite.config.js` | Browser entry point, local Vite configuration and API proxy. |
| `package.json`, `package-lock.json` | Node dependencies, pinned dependency graph and project commands. |
| `.env.example`, `.gitignore` | Environment-variable template and exclusions; the actual `.env` can contain secrets and is not a public project document. |
| `src/main.jsx`, `src/styles.css` | React application shell, route rendering, selection state, site pages and responsive styling. |
| `src/components/MapCanvas.jsx` | Interactive 2D map, view controls, labels, geometry, amenity composition and 3D integration. |
| `src/components/Colony3D.jsx` | Lazy-loaded 3D scene, camera controls, plot/amenity rendering, selection and fallback. |
| `src/components/PlotDetails.jsx`, `Compare.jsx`, `ContactForm.jsx` | Plot details and units, comparison, enquiry and visit workflows. |
| `src/components/Admin.jsx` | Authenticated owner/staff workspace for review, inventory, leads, content, roles and audit. |
| `src/components/MapPositionEditor.jsx`, `PresentationEditor.jsx` | Owner previews for amenity positions and reviewed plot presentation placement. |
| `src/components/AmenityArtwork.jsx`, `AmenityFigure.jsx`, `LeisureFacility.jsx` | Amenity images, captions, proposed pool/gym visuals and fallbacks. |
| `src/services/api.js`, `amenities.js` | API client helpers and amenity image handling. |
| `shared/domain.mjs` | Shared schemas, domain rules, conversion, filtering, permissions and label utilities. |
| `shared/owner-amenity-references.mjs` | Owner-indicated illustrative amenity references, placement helpers and review metadata. |
| `shared/presentation.mjs`, `scene3d.mjs` | Presentation-only plot transforms and explicit 2D/3D coordinate/path handling. |
| `server/app.mjs`, `server/start.mjs` | Express API routes, middleware and server startup. |
| `server/auth.mjs`, `inventory.mjs`, `content.mjs` | Authentication/permissions; plot and inventory operations; content validation. |
| `server/geometry.mjs`, `media.mjs`, `db.mjs` | Geometry/revision handling, private/public media handling and database connections. |
| `server/migrations/` | Versioned additive SQL migrations; review and back up before applying to an existing database. |
| `server/seed.mjs` | Initial data import for a new empty development database only; do not reseed existing owner data. |
| `public/data/layout.json` | Projected drawing, draft cells, map paths, approximate dimensions and review warnings. |
| `public/data/source-areas.geojson`, `reconstructed-cells.geojson` | Source areas and reconstructed draft-cell geographic data. |
| `source-data/` | Preserved KML, PDF and owner-supplied concept references. |
| `public/assets/` | Browser-served source images, plans, icons and separately derived/optimised concepts and textures. |
| `scripts/` | Source preparation, asset rendering/optimisation, database utilities, public-file preparation, manifest generation and data tests. |
| `tests/`, `playwright.config.js` | Unit/integration, source preservation, persistence and isolated browser/end-to-end checks. |
| `deploy/` | Example reverse-proxy, service and PostgreSQL-role configuration. |
| `docs/` | Data provenance, review templates, API, workflow, deployment, asset inventory, audits and delivery reports. |
| `PRD.md`, `PROJECT_LAYOUT.md` | Product requirements and the project map you are reading. |
| `CODEX_MASTER_PROMPT.md`, `SHUBH_MANGAL_3D_MASTER_PROMPT.md`, `Shubh_Mangal_Codex_Master_Prompt.md` | Supplied project instruction and reference briefs. |

### Database model at a glance

The migrations define users/sessions, source geometry revisions and draft cells, approved plots and geometry mappings, reviewed dimensions and verifications, inventory/price history, enquiries and visit requests, content, audit logs, import previews, geometry proposals, idempotency keys and rate-limit records. Detailed constraints and operations are documented in [docs/API.md](docs/API.md), [docs/DATA_NOTES.md](docs/DATA_NOTES.md) and the SQL migrations.

## 6. Generated, local and private directories

| Path | Purpose | Handling |
| --- | --- | --- |
| `node_modules/` | Installed dependencies. | Generated by npm; do not edit by hand. |
| `dist/` | Production build output. | Generated by `npm run build`; not source. |
| `public/downloads/` | Public KML/PDF/CSV copies prepared by the project scripts. | Generated from source documents/templates by normal predev/prebuild preparation. |
| `.env` and other local environment files | Local configuration and potentially sensitive credentials. | Private; do not commit or copy into product documents. Use `.env.example` as the template. |
| `.local/database/`, `.local/media/`, backups | Persistent local database, privately staged media and local backups. | Preserve existing owner and customer data; back up before migration or recovery operations. |
| `reports/` | Local screenshots and review artifacts from previous work. | QA evidence, not source geometry or proof of production readiness. |
| `test-results/`, `playwright-report/` | Browser test output. | Generated artifacts; may be replaced by later test runs. |
| `.git/`, if configured | Git metadata. | `git status` was unavailable at inspection because this directory was not a usable Git repository. |
| `.agents/`, `.codex/`, `.aws/`, `.openai/`, if present | Environment/tool configuration. | Outside the application source inventory; may contain private configuration. |

## 7. Key configuration and commands

Node.js **24.16 or newer** is required. The current local API was reachable in local-demo/PGlite mode when this guide was written; zero public plot records were returned. The source drawing contains 556 unverified cells, including 32 identity-review cases. These are observations of the inspected state, not claims about actual property inventory.

For the existing local database, start the API and frontend in separate terminals from the project directory:

```bash
APP_ORIGIN=http://127.0.0.1:5180 npm run api
```

```bash
npm run dev -- --port 5180 --strictPort
```

Open `http://127.0.0.1:5180/explore`. If the services are already running, refresh the page rather than starting conflicting processes. If dependencies are missing, `npm ci` installs them from the lockfile. **Do not run `db:seed` on an existing database.** See [README.md](README.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for a new empty database, safe migration, backup, recovery and production setup.

Useful checks:

```bash
npm run lint
npm run test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/google/chrome/chrome npm run test:e2e
npm run manifest
```

The Chromium path is an example from the previous local environment; use the installed executable or Playwright-managed browser on another machine. The E2E server uses isolated test data. See [test coverage](docs/TEST_COVERAGE.md) for conditional browser test configuration.

## 8. Information that still needs review

The owner and/or surveyor must reconcile plot IDs, labels, blocks, dimensions, availability and prices; confirm the entrance and amenities, including the proposed pool and gym; and decide public contacts, media rights, privacy, hosting, backup and notification arrangements. The 3D view is a simplified concept and physical-device testing is still needed. [PRD.md](PRD.md) lists the product acceptance criteria and outstanding decisions.
