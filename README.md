# Shubh Mangal Residency

A React/Vite customer website and authenticated owner workspace, built around the supplied colony geometry. The map, source documents and warnings are preserved. The application now includes persistent enquiries/visits, reviewed inventory, roles, version-protected updates, audit history, comparison and a mobile map/list experience.

**All supplied cells remain unverified.** The seed imports 556 draft drawing cells and publishes zero plots. The supplied north-oriented PDF is the owner-selected review reference, subject to individual owner review. There are no verified prices, sales statuses, legal dimensions, approvals, public contacts or entrance coordinates in the supplied inventory.

## Run locally

Node 24.16+ is required (tested 24.21.0).

For a **new, empty** local database, install dependencies and initialise the draft source data with the API stopped:

```bash
npm ci
cp -n .env.example .env
npm run db:migrate
npm run db:seed
```

For an existing database, do not reseed it. If a migration is required, stop the API and make a backup first; see [deployment and recovery](docs/DEPLOYMENT.md).

Set APP_ORIGIN in `.env` to the exact frontend URL, normally `http://127.0.0.1:5173`. In two terminals:

```bash
npm run api
```

```bash
npm run dev
```

Open http://127.0.0.1:5173. The local database is persistent PGlite (PostgreSQL in-process) under `.local/database`, not a JSON backend. Stop the API before running database CLI commands: one process owns the local database at a time. For production use PostgreSQL through DATABASE_URL; production rejects the local substitute.

To create the first owner, stop the API, privately set OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD (14+ characters) in `.env`, run `npm run db:owner`, remove OWNER_PASSWORD, and restart the API. There is no default administrator or browser-side admin flag. Visit `/admin` to sign in.

Without the API, the public site clearly displays demonstration/local mode. Contact forms download an unsent local draft. With the local API, successful requests return a persisted reference and explicitly say that no notification was sent. Production forms acknowledge only after a database commit. A visit request starts as **requested**, never confirmed.

## Working routes and flows

- `/`: calm source-led introduction, Explore and Visit actions, facility confirmation labels, guided sequence.
- `/explore`: source-derived SVG, pan/pinch, zoom, reset/focus/fullscreen, collision-aware labels, measurements, filters, accessible results and mobile map/list switch. Illustrated Colony is labelled not to scale; Source drawing retains the source shapes and an approximate map-derived scale. Original plan shows the supplied plan image/PDF separately without an invented overlay. Switching views keeps the selected record. Approved blocks are derived only from published, owner-reviewed memberships; draft KML plan-section names are never promoted to customer blocks. `?block=<name>` opens an approved block.
- `/plots/:id`: published immutable approved IDs with details and browser history. Legacy `?plot=<draftId>` remains a clearly marked provisional reference. Unknown/unpublished IDs never resolve to another plot.
- `/compare`: up to three selections, with missing fields explicitly “Not provided”. Draft comparisons are labelled illustrative. The selection survives reload in the current browser tab; records no longer in the current data are identified and can be removed.
- `/location`, `/amenities`, `/gallery`, `/documents`: source materials separated from verified content. Directions use the approximate drawing centre until an owner-confirmed entrance is published. Historic poster approval claims are prominently unverified.
- `/contact`: general/plot enquiries, visit requests, validation, consent, IST dates, retry idempotency and failure retention. Plot links keep their selection while data loads; an unavailable plot must be explicitly changed or cleared.
- `/privacy`: truthful local/connected data handling and outstanding owner retention decisions.
- `/admin`: session login, explicit block/identity approval, evidence/dimensions, inventory and price controls, lead follow-ups, visit states, CSV previews and atomic commits, reviewed geometry revisions, content/amenity locations, private image staging, staff roles and append-only audit.

Shortlists remain in this browser only; comparisons persist for the current tab. Verified and map-derived dimensions are separate; source feet/inches text is preserved. Availability fills and the gold selection outline are independent. Owner-indicated amenities and four roundabout gardens appear as explicitly approximate previews in local/offline demo mode. In connected mode, only visible, published amenity records appear. Their positions, scale, orientation, description and publication are controlled in the owner workspace; they are not evidence of constructed facilities. A shared temple/garden composition has separate adjustable foregrounds and amenity entries. The 2D views use fitted artwork with an Amenities toggle and a keyboard-accessible list. The illustrated scene adds subdued surfaces, planting and a presentation-only plot inset; status colours remain separate. Bookings, payments, live notifications and satellite basemaps are not implemented.

To review the supplied concepts, open Content in `/admin` and choose **Stage owner-indicated amenities**. This adds private drafts only when their reserved IDs do not already exist; it does not overwrite existing content or publish anything. Adjust each marker on the highlighted plan or by coordinates; the owner editor previews its image, scale and rotation. The shared visual and all four corners are separately adjustable. Enter evidence and a reason, and have an authorised owner/administrator publish only after review. The preview locations are approximate working anchors, including the road entrance; see [the reconciliation guide](docs/RECONCILIATION.md). The original PNGs are retained, with smaller WebP copies for display; see [the asset inventory](docs/ASSET_INVENTORY.md).

The **Illustrated layout** owner tab can preview an optional visual placement for an existing approved plot ID and its current source geometry. Presentation transforms can extend beyond the source polygon within the scene and are saved as a draft, reviewed and published separately. Review the complete layout for overlaps, roads and neighbour relationships before publication; the preview shows source context but not other staged placements. It changes neither the original geometry nor dimensions, status, price or stable ID. If a plot is unpublished or its geometry mapping changes, its published visual placement is not served. The default presentation inset is a visual treatment, not a survey.

The clubhouse area also includes separately selectable **proposed** pool and outdoor gym concepts. Their default positions are draft illustrations, not proof of construction or surveyed locations. In Content, stage the owner-indicated references and review each facility's position, scale, rotation, description, status and visibility independently before publication. Previously saved owner content is never overwritten by staging.

The optional **3D colony** tab lazily loads Three.js and React Three Fiber, renders interactive schematic 3D forms from the same plot presentation paths, and retains the same selected plot and amenity records as the 2D explorer. Rotate, tilt, zoom, whole-colony reset, top view, focus, label and amenity controls are available; filters and approved blocks follow the same records. On touch devices, enable touch controls to orbit or pinch, then disable them to scroll the page. If WebGL cannot run, the user can return to 2D. The models are schematic concepts, not measurements, photographs or surveyed building models. Three.js and React Three Fiber are MIT-licensed dependencies; their code is downloaded only when the 3D view is opened. The current production build's 3D chunk is approximately 1.10 MB minified (297 KB gzip), so slower connections may notice its first load.

## Architecture

| Layer          | Implementation                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Customer UI    | React 19, Vite, native SVG, system fonts; lazy map/admin chunks                                                              |
| State          | One URL-selected plot ID, derived record, separate view/filter/unit state                                                    |
| API            | Node ESM / Express, shared Zod schemas, JSON errors, request-ID logging                                                      |
| Database       | Parameterised SQL; production PostgreSQL via pg; local PGlite with the same migrations                                       |
| Authentication | Scrypt password hashes, random server-side sessions, HttpOnly SameSite cookies, expiry, origin and CSRF checks               |
| Permissions    | Owner, administrator, sales, reviewer, viewer, content editor; enforced server-side                                          |
| Consistency    | Conditional version writes inside transactions, idempotency, advisory locking for duplicate requests                         |
| Integrity      | Publication gates, UUID mapping, independent verified dimensions, append-only audit/status/price/verification history        |
| Security       | Helmet headers/CSP, body limits, database-backed rate limits, honeypot, no public lead responses, no credentials in frontend |

The same public inventory projection feeds map/list/details/compare/forms. Public data is refreshed on navigation, tab focus and every 60 seconds; fetch failures are labelled stale. A stalled drawing or initial connection times out after 12 seconds and offers retry or an explicitly unsent local draft as appropriate. Submission rechecks selected records. Source geometry regeneration never updates approved IDs automatically.

## Checks and build

```bash
npm run lint
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
npm audit
```

If Chromium is already installed, set PLAYWRIGHT_CHROMIUM_EXECUTABLE to its executable instead of downloading it. E2E uses ports 3002/5181 and a disposable database, not real inventory. `dist/` is generated only by Vite. `public/downloads/` is copied from original sources by predev/prebuild. No original file is overwritten.

`npm run preview` previews the static build only; it is not the backend. Production uses `NODE_ENV=production npm start` after proper environment/database provisioning, serving the build and API on the same origin. Exact release, TLS, database-role, migration, backup and recovery commands are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Repository guide

- `src/main.jsx`, `src/styles.css`: application shell, public pages and responsive visual system.
- `src/components/`: map, details, comparison, forms and owner workspace.
- `src/services/`: API and browser storage/download helpers.
- `shared/`: schemas, permissions, conversions, search/filter and label placement.
- `server/`: API, authentication, inventory, geometry revision validation, content schemas, database adapters, seed and migrations.
- `tests/`: unit/integration, persistence/recovery and browser workflows.
- `scripts/`: original source conversion/render scripts and retained data tests; build preparation, database commands and manifest maintenance.
- `deploy/`: nginx, systemd and restricted PostgreSQL role examples.
- `public/data/`, `public/assets/`, `source-data/`: preserved supplied geometry, images, original KML and PDF.

[Product requirements](PRD.md) · [Project layout and architecture](PROJECT_LAYOUT.md) · [Requirement checklist](docs/REQUIREMENTS_AUDIT.md) · [Inspection audit](docs/IMPLEMENTATION_AUDIT.md) · [Asset inventory](docs/ASSET_INVENTORY.md) · [Data rules](docs/DATA_NOTES.md) · [Owner workflow](docs/WORKFLOW.md) · [Reconciliation guide](docs/RECONCILIATION.md) · [API contract](docs/API.md) · [Deployment](docs/DEPLOYMENT.md) · [Delivery and validation](docs/DELIVERY.md)

## Before public launch

Owner review is required for every plot, all 32 identity issues, unsplit blocks, duplicate labels, current availability, prices, verified dimensions and their source revisions. Confirm contacts, entrance, facilities, public document permissions, privacy retention and hosting. No real site photography, government/loan proof, RERA evidence or verified nearby landmarks were supplied. Hindi primary copy and language preference are implemented; an owner-reviewed full Hindi translation and physical device checks remain appropriate before broad launch.

The source counts, provenance and conversion pipeline are documented in DATA_NOTES. Do not regenerate the original drawing over approved production mappings. No production service has been deployed from this workspace.
