# Data interpretation and measurement rules

## Evidence hierarchy

1. A current owner-approved survey/layout and confirmed inventory are the production source of truth, once supplied.
2. The supplied PDF provides plan annotations; it has not been confirmed as the latest authoritative revision.
3. The KML provides geographically placed drawing geometry and labels; it is not proof of surveyed accuracy.
4. The marketing poster provides branding and advertised claims; it is not an inventory/status source.
5. Derived JSON, images, and reconstruction are engineering aids requiring review.

## Important source facts

- Uploaded `kartik.kml` was a NetworkLink. The linked complete KML was retrieved and included as `source-data/Shubh_Mangal_Full_Layout.kml`.
- Original folders: `Roads, plots & areas`, `Borders & lines (white)`, `Text labels`.
- 712 source placemarks, including 1,806 polygon primitives and 410 line primitives. Many polygons are outlines of individual letters/numbers. These are not saleable-plot counts.
- `PLOT 1` etc. name grouped source drawing areas, not necessarily approved customer-facing blocks or individual plots. Individual labels such as B26 are drawn as text geometry and require reconciliation.
- There is a source spelling `PLOY 17`; preserve provenance and normalise separately only after review.
- Projection for draft measurements: WGS84 longitude/latitude transformed to UTM zone 43N, metres. SVG Y runs downward; geographic latitude runs northward.
- The draft pipeline splits named blocks with their named divider lines, extending divider endpoints by 2m to bridge drafting gaps. Cells smaller than 1m² are excluded. Small source vertices are simplified at 0.12m for edge display.
- Numeric label matching uses the drawn label's centroid. Single matches are candidates, not ownership/identity verification. Duplicate matches within a block are flagged.
- Final audit: 556 draft cells; 524 unique single-label matches; 32 review cases. No plot identity, status, area, facing, price, or dimension is legally certified by this pipeline.

## Measured versus verified

Map-derived length is the Euclidean distance between consecutive simplified projected vertices. It is useful for interface development and an approximate overlay, but may differ materially from the PDF/survey. It must always carry an approximation marker. Do not round an estimate into a claimed survey value.

Verified dimensions must be stored separately, with source revision, verification status, and review date. For an irregular plot use named sides and vertex/edge references; do not force all shapes into a rectangle. A verified legal area should be stored independently of computed geometry area.

Conversions:

- 1 ft = 0.3048 m.
- 1 sq ft = 0.09290304 sq m.
- 1 sq yd = 9 sq ft = 0.83612736 sq m.
- `25'6"` means 25.5 feet, not 25.6 feet.
- A metre label such as `6.7 × 13.72` must not be parsed as feet.

The number displayed beside a boundary can be confidently called Front/Rear/Left/Right only when frontage/entrance orientation has been established. Until then use Edge 1, Edge 2, etc.

## Production review workflow

1. Obtain the latest approved plan and an owner-confirmed plot list.
2. Open the interactive cell next to the PDF and record the approved ID/number in `inventory-review-template.csv`.
3. Confirm source revision and all four/six/etc. sides as applicable.
4. Reconcile all 32 flagged cases; split or merge draft cells manually where needed.
5. Resolve same plot numbers in different sections using an approved phase/block prefix.
6. Map immutable production plot IDs to draft geometry IDs. Never use just the visible number as a primary key.
7. Apply current availability/price from a separate authorised inventory source.
8. Only approved public records become production inventory. Keep uncertain geometry in an internal review layer.

The CSV has no populated verified measurements or invented availability. It is deliberately a review template.

## Implemented relational model (2026-11-01)

The original supplied JSON/GeoJSON/KML, source annotations, review template and images remain byte-for-byte unchanged. `reviewRequired=true` remains present for every supplied GeoJSON cell. The original prototype IDs are stable only within this source revision. The application distinguishes source facts from owner-reviewed business facts.

- `geometry_revisions`: content-addressed source hash and provenance. The supplied layout SHA-256 is `fe76aa56592f85546ebefdcf1ad187a0602cb8bfc355a22d06fadc89c228fb8f`.
- `draft_cells`: provisional source IDs and immutable imported geometry JSON. All require review; identityReviewRequired additionally identifies the 32 known ambiguity/duplicate cases.
- `plots`: server-generated immutable UUID, approved display number/block, version, status and separate draft/reviewed/published/archived state. A same-block approved number is unique. Creation stages a draft; a reviewed label is not itself a published plot.
- `plot_geometry`: immutable plot ID mapped to one reviewed source cell/revision; mapping changes require a proposal and owner decision. Existing enquiries keep their plot UUID and submission-time context.
- `plot_dimensions`: named sides, original source text, metre value, optional zero-based geometry edge index, source revision, reviewer and date. Verified area remains independent in `plots.data`; source area text is retained. Geometry area never replaces verified area.
- `plot_verifications`, `inventory_status_history`, `price_records`, `audit_logs`: append-only review/change history. Audit records contain actor, old/new business values, reason and timestamp. Buyer contact/notes remain in private lead records instead of being duplicated into permanent business audit.
- `enquiries` and `visit_requests`: private consented contact and immutable selected-context snapshots; requested/confirmed visits are separate states with optimistic versions.
- `users`, `sessions`, `content`, `idempotency`, `rate_limits`, `import_previews`, `geometry_proposals`: protected operational state. Content includes settings, amenities, media/documents and nearby places with draft/published payloads.

Owner decision recorded during implementation: **use the supplied north-oriented PDF after owner review**. No supplied measurements or sales statuses were thereby verified, and no real inventory was published by seed or tests.

Public approved records include the current approved identity plus source geometry/provenance. `sourceIdentityReviewRequired` and `sourceReviewRequired` preserve source warning context even after an owner resolves the business identity. Approximate numbers always display “Approx.” or “Map-derived”. Verified area/sides display “Verified” and carry source/reviewer metadata internally. Frontage is a reviewed named-side assertion, never inferred from the first edge.

New split/merge geometry is staged through an authenticated revision endpoint. It accepts only closed single-ring Polygon features within the supplied region, recomputes projected UTM measurements, rejects obvious invalid rings/overlaps, and marks all new cells for review. It does not certify topology, survey accuracy or legal boundaries. Gaps, relationships to earlier revisions, slivers and source conflicts still need surveyor review. Source revisions and originals are never overwritten. See RECONCILIATION.md.

The preserved source review CSV is evidence, not an approved block list. Identity import stages new drafts only and requires an explicit `approvedBlock` separate from `sourceBlock`; it rejects a sourceBlock that conflicts with the selected source geometry and rejects an existing approved ID. A separate inventory CSV uses existing UUIDs, expected versions, optional status/price changes and reasons. Preview/commit is atomic and version-checked. The supplied CSV remains unchanged and contains no invented measurements or status.

Owner-reviewed phase, corner and park-facing attributes are nullable/empty by default and are never inferred from the drawing. Their absence means “Not provided”. Amenity content has optional coordinates, English/Hindi names, category, state, source, review date, asset and visibility. Additive JSON fields `placementPrecision` (approximate/surveyed), `visualScale` (0.5–1.6), `visualRotation` (-180–180 degrees) and `descriptionHi` have defaults for older records; no SQL schema migration or owner-data rewrite is needed. The server projects a published location to the source drawing; it is not proof of an existing building. Owner-provided concept PNGs and approximate reference anchors are documented in ASSET_INVENTORY.md and RECONCILIATION.md. The optional staging action creates private drafts without overwriting records; connected public mode requires explicit publication. Other raster media is privately staged outside the release until referenced by approved visible content.

Amenity image viewport crops and illustration sizes are presentation metadata in `shared/owner-amenity-references.mjs`, not measurements or revised property polygons. The visual clip bridges near-coincident shared temple/garden edges only for rendering; validation continues to use the original source areas. Existing owner coordinates and other database content are not rewritten by a presentation update.

Four independent roundabout garden records and one shared temple/garden visual can be staged as private content through the existing audited workflow. The shared composition is rendered only when it and both individual amenities are visible, the individual concepts are still their bundled defaults and their locations are not surveyed. Its top-down temple and playground foregrounds use their individual record locations, scales and rotations, composed with the shared visual transform. Custom owner images and surveyed locations keep their separate rendering. Surface textures are presentation-only masks; unverified, reserved and sold plots use a neutralised texture and retain their own status colours. The road texture is restricted to the mapped road and owner-indicated approach areas, and uses an unmarked source patch. No new road, lawn, or amenity construction fact is recorded.

The illustrative map uses each existing plot path and ID, inset uniformly to 94% only when it remains within its source polygon; two source polygons fail that check and stay unchanged. The original source drawing and PDF are available separately. A full-size transparent source hit target preserves selection at the visual edge; reviewed moved plots instead use their presentation path. A short map-native continuation beyond the end of `area-31` is explicitly illustrative, derived from its direction and width solely to keep the entrance visually continuous; it is not evidence of a real external road or its width. Published owner presentation placements are keyed by the immutable approved plot ID **and** current source geometry ID; the server rejects unknown/stale mappings and placements outside the scene bounds, but a reviewed visual placement may extend beyond its source polygon. Road clearance, overlaps and neighbour relationships require manual review before publication. Draft and published presentations are separate and audited. Public projection excludes a placement when the plot is unpublished or its geometry mapping no longer matches. Transforming visual edge points never changes stored metre/feet values or area. The illustrative view has no distance scale.

Migration `003_visit_no_show.sql` changes only the visit-status constraints: it adds `no_show` and requires an agreed slot, without rewriting existing visits. Applied migration history and the pre-migration local backup are retained. A geometry reassignment now records a status-history entry when resetting status and clears geometry-dependent verified facts and public price visibility before re-review.

### 3D visual coordinates

The scene takes the existing local projected drawing coordinates, not raw longitude/latitude. Its explicit visual conversion in `shared/scene3d.mjs` maps drawing `[x, y]` to Three.js world `[x, height, y]`: x points east, world y points up, and world z points south. `fromWorld` reverses x/z back to the drawing coordinates. Height is illustrative and is never used to calculate a sales dimension. The line-path parser supports the actual M/L/Z source paths, multipart rings, holes and nested islands; unsupported curves and invalid rings fail closed. The current source road has 31 rings, retained as one outer shape with 30 holes, and all 556 supplied cell paths are renderable. Presentation shapes are keyed to their existing plot and geometry IDs; verified and approximate measurements remain those from the data records, not the rendered 3D shapes.
