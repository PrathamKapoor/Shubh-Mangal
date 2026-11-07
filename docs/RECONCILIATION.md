# Data reconciliation guide

## Authority and unresolved source issues

The owner chose the supplied north-oriented PDF as the review reference, **after owner review**. No individual record has been verified by that choice. Source images and original files remain unchanged. The poster is a marketing source, including unverified approval/loan/facility claims, not evidence of current legal or business status.

## Owner-indicated amenity references

The following **working anchors**, in the existing projected drawing's local metre coordinates, position illustrations for review. They are not surveyed coordinates, proof of construction, or approval of the facilities. Membership is based on the owner's written area descriptions and the named/nearby KML areas; no separate annotated screenshot was supplied. The source field is nevertheless set to the owner-requested wording “Owner-provided screenshot reference”.

| Concept | Initial x, y | Indicated area and owner review still needed |
| --- | --- | --- |
| Fountain | 167.26, 143.32 | Centre of the circular roundabout (`area-30`); check exact centre and size. |
| Temple | 286.54, 130.80 | Small temple portion of the shared area beside the 357–366 / 381–390 plan labels (`area-40`); exact position is a draft. |
| Play Garden | 292.00, 150.00 | Shared area beside those same plan labels (`area-2`); exact position and separation from the temple are drafts. |
| Shared temple/garden artwork | 290.00, 141.00 | Separate adjustable visual in `area-2` / `area-40`; the two amenity entries remain separate and the image is illustrative. |
| Clubhouse | 63.00, 220.00 | Green area below the B1–B4 / B50–B52 plan labels (`area-3`); exact footprint is a draft. |
| Proposed swimming pool | 65.50, 242.00 | Draft concept in the clubhouse area (`area-3`); location, deck and construction need review. |
| Proposed outdoor gym | 67.70, 259.50 | Draft concept in the clubhouse area (`area-3`); location, equipment and construction need review. |
| Entry Gate | 107.50, 460.00 | Lower-left approach-road area (`area-31`), initially rotated 1.5° across the road; exact position, orientation and opening need confirmation. |
| Roundabout gardens NE / SE / SW / NW | 184.86, 128.20 / 188.29, 153.25 / 144.17, 156.25 / 144.19, 134.97 | Separate draft anchors clipped to `area-41` / `area-42` / `area-43` / `area-44`, respectively. Initial rotations are 94.3° / 160.3° / −74.2° / −25.1° and can be changed independently. |

An authorised user can stage these as private content drafts, move them within the highlighted indicated areas, change scale and rotation, and document their status/source before publishing. The adjusted clubhouse anchor applies to demo previews and newly staged records; existing saved owner coordinates and image paths are never rewritten. The clipping areas and initial anchors are interpretation aids, not legal boundaries; if owner evidence places a facility outside one, update the reference geometry through a reviewed code/data change rather than forcing an incorrect point. Source geometry and plot identities are not altered by this workflow.

The draft audit identifies 556 reconstructed cells, 524 unique within-block single-label matches, and 32 missing/ambiguous/duplicate cases. In particular:

- PLOT 16 is one reconstructed cell with ten label candidates; it must not become one saleable plot by inference.
- PLOT 14 has duplicate matches for 392–397.
- PLOT 20/21/22 contain cells with missing labels.
- PLOY 17 is the original source spelling; preserve it in provenance, even if the approved block name differs.
- PDF and poster subdivisions conflict. Some SIDE/amenity/unsplit source areas remain context, not inventory.

Use `DATA_AUDIT.json` for the exact 32 IDs and `source-annotations.csv` for the unaltered label coordinates. Every cell, even a unique label match, needs owner/surveyor review. Do not use the drawing counts as a legal sale inventory.

## Identity and dimensions

1. Open Data review; select the source geometry and inspect the north-oriented PDF beside it.
2. Record the approved number and approved block. Numbers can repeat in different approved blocks; the immutable UUID distinguishes them. Same-block approved numbers cannot duplicate.
3. Record document name/revision, review reason, exact source area text and optionally the verified metre area. Conversion constants are in DATA_NOTES. Leave unknown values empty.
4. Add named side dimensions, retaining text such as `25'6"` or `6.7 m`. The parser requires a unit and inches under 12. Do not feed dimension pairs into a scalar field. Drawing edge numbers start at 1 in the UI; API edgeIndex is zero-based. Leave it unset if the source cannot be matched reliably to an edge.
5. Do not name a side Front until road/access orientation is verified. Irregular polygons remain irregular. Legal area is independent of geometry area. A >5% discrepancy is shown for review, not automatically corrected.
6. Save draft → reviewer marks reviewed → owner/administrator publishes. Store current sales status and price separately, with a reason. No test fixture or source status is real business inventory.

Approved UUIDs are never editable. Renaming a plot retains links and lead references. Archived/unpublished public links return unavailable; they never redirect silently to a new plot. Review-required source indicators remain available in the approved public record as sourceIdentityReviewRequired/sourceReviewRequired.

## CSV preview and commit

The supplied `inventory-review-template.csv` is unchanged. Start with a small reviewed subset; do not upload all blank rows expecting automatic approval.

Required for each new staged identity: draftGeometryId, approvedPlotNumber, **approvedBlock**, surveyDocumentRevision, ownerReviewedAt, and notes (at least eight characters explaining evidence). `sourceBlock`, when provided, must match the original draft cell and remains evidence only; it is never used as the approved block. Add an `approvedBlock` column to the preserved review sheet, or use the separate blank identity-approval template. Optional verifiedAreaSqFt is converted exactly to m² while preserving the original value/unit. availability must be empty or unverified; priceINR/frontageFeet/depthFeet must remain empty for this importer. Enter named sides and inventory in their dedicated workflows.

Existing approvedPlotId is intentionally rejected by the new-identity importer. This prevents accidentally recreating or replacing approved IDs. Unknown geometry, duplicate approved block/number, duplicate geometry, malformed rows and already mapped cells receive row-numbered errors. A preview with any errors cannot commit. A successful commit is atomic, stages drafts, and returns IDs. The preview belongs to the initiating reviewer, expires in 30 minutes, and can be committed once. Retrying an identical request with its same idempotency key returns its prior result.

For an existing identity use the separate Inventory update CSV: download current approved UUIDs and expected versions from the owner workspace. Provide at least one of status, priceINR or priceVisible and a reason; blank fields mean unchanged, `clear` explicitly clears price, and visibility must be `true` or `false`. Review the before/after preview. Every row is rechecked at commit: a stale version or invalid row aborts the entire batch. Successful updates use the same permission, status-history, price-history and audit rules as individual edits. This import cannot change a UUID, geometry, approved block or dimensions.

## Split / merge / source revision workflow

There is no automatic survey correction or pixel tracing. Use a GIS editor to prepare the intended polygons, check gaps/overlaps against the authoritative PDF and prior revision, then export the following JSON to Geometry revisions → Stage a split / merge geometry revision:

```json
{
  "sourceDocument": "Owner-reviewed plan document name",
  "sourceRevision": "Owner-approved revision identifier",
  "reason": "Evidence and explanation of the proposed correction",
  "features": [
    {
      "type": "Feature",
      "properties": {"label": "Candidate number", "block": "Source block"},
      "geometry": {"type": "Polygon", "coordinates": ["REPLACE_WITH_REVIEWED_CLOSED_COORDINATE_RING"]}
    }
  ]
}
```

The placeholder is deliberately invalid: do not invent coordinates. Use actual `[longitude, latitude]` pairs from the reviewed source. Current importer accepts one closed outer ring, 4–100 coordinates per polygon, up to 100 polygons, within longitude 74.90–74.92 / latitude 24.46–24.48. Holes/MultiPolygons require a future explicit geometry contract rather than flattening them incorrectly. Self-crossing/zero-length rings, obvious pairwise overlaps and areas under 1 m² are rejected. Passing engineering checks is not survey verification.

Staging computes UTM 43N paths/edges/areas server-side and creates content-addressed revision IDs and new draft geometry IDs. All new cells require review. Original revisions and approved mappings remain untouched. The response downloads the IDs/provenance for review.

- **Reassign/correct:** propose the replacement draft ID, existing plot UUID, current version and reason. Owner approval changes the mapping in a transaction, increments the version, unpublishes the plot and clears verified dimensions/area/status. Re-review evidence before publishing.
- **Split:** stage the reviewed sub-polygons. Retain the existing approved UUID for the owner-selected continuing parcel using a reassignment proposal. Create new identities for the other reviewed parcels. Reconcile old enquiries with their submission-time context; do not silently transfer interest or ownership. Publication of each resulting parcel is an explicit owner step.
- **Merge:** stage the reviewed merged polygon. Owner chooses the surviving business UUID, archives other superseded approved records, then reassigns the surviving UUID. Old lead references and audit records remain. This is a deliberate multi-step business review, not an atomic automatic merger of sales commitments.
- **Undo:** inspect the geometry.reassign audit event, propose the previous geometry ID for the same approved UUID at its current version, and obtain owner approval. Previous verified measurements remain in historical verification events; re-review them before restoring publication. Never delete history or reuse a UUID for an unrelated parcel.

The importer does not prove containment within a legal boundary, reconcile every old revision, or guarantee a gap-free topology. Those are explicit surveyor checks. The public source KML download continues to identify the original source; it is not automatically relabelled as the latest legal geometry.

## Owner information still required

- Confirm each approved number/block and authoritative revision, especially all flagged/unsplit cells.
- Verify legal/approved area, individual sides, frontage/access, road width, facing and plot type.
- Supply current availability and authorised prices; choose which prices may be public.
- Verify approvals/title independently and grant permission for public source documents.
- Confirm public phone/email, WhatsApp number, entrance and approach directions.
- Verify amenity state/completion, nearby places and distance methods.
- Supply real dated photos/video and approved media when available.
- Choose hosting/domain, staff accounts, retention/privacy contact, backups and notification provider if desired.

None of these values has been fabricated or silently filled during implementation.
