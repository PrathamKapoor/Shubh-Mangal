# Visitor and owner workflow

## Visitor

Home → Explore plots → choose an approved block or search/filter → select a plot → inspect the same record → choose feet/metres and area unit → shortlist locally → compare up to three → copy a link → enquire or request a visit. Switch among Illustrated Colony, interactive 3D Colony, 2D plan (Source drawing) and the original supplied plan document without losing the selected record. The illustrated 2D and 3D compositions are not to scale or photographs; the 3D buildings and landscaping are conceptual models. The source drawing retains the source polygon paths; the original document is shown separately without a speculative interactive overlay.

On phones, use Map / Plot list. Drag or pinch the map; scroll the surrounding page normally. Mouse users can use +/− or Ctrl+scroll. Keyboard users select result buttons and use arrows/+/-/Home on the map. Fullscreen has Escape and a focus loop. Source plans open at full resolution. Approximate values are always labelled. A comparison is retained on reload in the current tab; unavailable selections can be removed from the comparison.

Source-only exploration is explicitly demonstration data. Approved plot links use `/plots/<uuid>`. Provisional query links still work for the supplied revision. Unknown, unpublished or archived links show an unavailable state and never another plot. Shortlist entries are on this browser, not synchronised accounts.

## Enquiries and visits

1. Choose a plot (optional for general enquiries), enter name, phone, optional email/message, preferred contact method, language and consent. Email is required if email is the preferred contact method. A plot link keeps its selection while data loads; if the plot is unavailable or the drawing cannot load, retry, select another plot or explicitly choose a general enquiry.
2. For a visit choose a future date and time. All requested/agreed slots use Asia/Kolkata, UTC+05:30.
3. The API validates and rechecks selected inventory, saves privately, and returns a reference only after commit. A retry with the same request key/body returns the same reference. Changed data uses a new key; contradictory reuse is rejected.
4. In local API mode, the response explicitly says it was saved locally without notifications. With no backend, the form downloads an unsent local draft. Initial connection and drawing requests time out after 12 seconds with an appropriate retry/fallback; failures preserve entered information. A failed refresh retains previously loaded published data as stale rather than substituting demonstration inventory.
5. Staff open Enquiries, update stage (new/contacted/qualified/closed), private notes, choose an active authorised staff member and enter the next action. Enquiries, visits and audit history have previous/next pages; audit can be filtered by entity ID.
6. Visits begin requested. Staff can record contacted, confirm an agreed future slot, reschedule, complete (attended), mark no-show after the scheduled time, or cancel according to server-enforced transitions. An outcome retains the agreed slot. Completed/no-show/cancelled visits are terminal records; arrange a new request if necessary.
7. No form submission reserves a plot or sends a payment receipt. Notification delivery is not configured. Published WhatsApp contact opens a draft only; it does not claim to send it.

## Owner sign-in and roles

Create the initial owner privately using db:owner. No default account exists. The server stores scrypt hashes, random session hashes and CSRF tokens; cookies are HttpOnly and SameSite. Production cookies are Secure. Sessions expire after eight hours. Origin and CSRF checks protect staff mutations. Staff can change their password in My account; an owner can reset another staff password in Staff access. Sessions are revoked on password/access changes.

| Role             | Permitted work                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Owner            | All business workflows, publish and manage staff access                                                               |
| Administrator    | Inventory, review, publication, content, leads, visits, audit; cannot manage roles                                    |
| Sales staff      | Inventory status/price updates on reviewed identities, lead follow-up and visit workflow                              |
| Data reviewer    | Reconcile identities, evidence/sides, mark reviewed, CSV staging, geometry proposals; no private leads or publication |
| Read-only viewer | Internal inventory and audit; no private contact records or mutations                                                 |
| Content editor   | Draft content, amenities, nearby places and media records; cannot publish                                             |

Permissions are enforced by the API. Opening an admin URL or changing localStorage cannot grant access.

## Review and publish

1. Open Data review and search a source label/block. Review the shape, candidate label and source PDF side by side. Open the PDF image at full resolution for source text.
2. Verify and explicitly enter the approved number and block against the supplied north-oriented PDF and current owner evidence. Neither is prefilled from a KML candidate. Resolve duplicate/missing labels deliberately. Enter evidence, document revision, original area text and optional verified area/sides, road width, facing, phase or corner/park attributes only when reviewed. To associate public plot documents, enter their reviewed content IDs; links appear only when those document records are published. Use explicit feet/inches or metre units for each side. Leave missing facts empty.
3. Save identity draft. The server assigns a UUID and records its source mapping. Availability remains unverified.
4. In Inventory inspect the draft evidence. Differences greater than 5% between approved and map-derived areas are surfaced; do not overwrite either automatically.
5. Mark reviewed with a reason. The reviewer and verification time are recorded. Owner/administrator then publishes the reviewed record in a separate transaction.
6. Use status/price controls only with current business evidence. Published price is opt-in. Updates require a reason and expected version. If another staff member changed the record, reload and reconcile; do not retry a stale write blindly.
7. Evidence edits return a plot to draft. Archive intentionally instead of deleting. All old/new important values and timestamps remain in history. Reverting a change means a new compensating update.

## Geometry revisions and bulk work

Identity CSV: use the preserved review sheet as evidence and add `approvedBlock`, or download the explicit approval template. Fill reviewed identity/evidence, preview errors and staged values, then commit a valid preview. Source-block names never supply approved membership automatically. Identity imports stage drafts only.

Inventory CSV: sales/owner/administrators can download current approved IDs and versions, fill only the status and/or price fields being changed plus a reason, then preview and commit. Blank values leave fields unchanged; `clear` removes a price if visibility is also false. All rows commit together or roll back on a conflict. Both previews expire in 30 minutes, belong to their initiating staff member, and use idempotent commit keys.

Geometry revisions: prepare reviewed split/merge GeoJSON in a GIS tool, stage it in Geometry revisions, then review the resulting draft cells. Propose a replacement mapping for the immutable plot ID. Owner approval returns the record to draft, clears geometry-dependent verification, sets status to unverified and records the previous mapping and status reset. Undo is a new proposal using the previous source ID. See RECONCILIATION.md for splits, merges and how lead references remain stable.

## Content

Content includes project contact/entrance, amenities, nearby places, media and documents. Source and verification metadata are mandatory for publication. Staff may save drafts; only owner/administrator can publish. Saving an edit as a draft unpublishes that item until review. Amenity states are confirmation_pending/planned/in_progress/existing. A source drawing does not establish completion.

The supplied concepts, the shared temple/garden visual and four individual roundabout garden copies can be prepared with **Stage owner-indicated amenities**. The operation is authorised, transactional and audited, creates private drafts only, and skips any existing records with the same IDs. It never overwrites an existing owner edit. Their source field is the requested label “Owner-provided screenshot reference”; the current placement evidence consists of the owner's written area descriptions and supplied map, not a separate annotated screenshot. These are approximate working positions, not surveyed coordinates.

The shared visual is a separate owner-editable record. In connected mode, publish it and both the Temple and Play Garden records to display the top-down shared composition. The default composition uses separate temple and playground foregrounds whose own position, scale and rotation remain adjustable; the shared visual can also transform them together. If either amenity is hidden, a location is surveyed, an owner has selected a custom image, or the shared visual is unavailable, the individual eligible amenity records render separately instead. Four roundabout gardens are distinct records; adjust and review their positions, scale and rotations separately. Existing records are not converted automatically. For an older fountain, clubhouse or gate record, an authorised owner may explicitly select the new image path after review; the earlier saved image and framing are otherwise preserved.

In **Illustrated layout**, choose an existing plot record and inspect its immutable ID and source geometry ID. Adjust the visual offset, uniform scale and rotation; the preview compares it with the source outline and nearby source shapes. The server rejects unknown or stale mappings and shapes outside the overall scene. Presentation can extend beyond its source parcel. Check overlaps, road clearance and neighbour relationships in the complete scene before publishing; the preview does not show all other staged changes. Add the placement to the draft, supply a source, review date and reason, and save. An owner/administrator can then publish that unchanged saved draft. Editing a new draft leaves the previous published presentation in place. A plot must itself be published before its placement can be published. The public API suppresses placements for unpublished plots and for mappings whose geometry has since changed; review and remove stale entries before the next publication. Block membership and geometry reassignment remain separate reviewed workflows.

For each amenity, enter English/Hindi names, category, description, state, source and review date. Use **Adjust position on plan** to choose a point in the highlighted area (arrow keys move approximately one metre), or enter latitude and longitude; adjust marker scale and rotation. The focused live preview shows the artwork clipped to the area, so check the entire image after each adjustment. **Show entire reference area** and **Focus current position** switch the editor's framing without changing the saved location. The server rejects a reference position outside its indicated source area. Record the evidence and reason, save a draft, then an owner/administrator can publish with customer visibility explicitly enabled. Demo mode also shows clearly labelled illustrative previews; connected public mode shows only published visible content. Do not treat an illustration as an exact gate, wall, constructed building or survey. See RECONCILIATION.md for the initial areas and remaining decisions.

For an image, choose PNG/JPEG/WebP up to 2 MiB and Stage image. It is private and previewable only by authorised content staff until a visible, reviewed record is published. Identify a photograph, concept or illustration accurately; only upload media the owner has permission to share. Existing reviewed `/assets/` paths still work. Strip sensitive EXIF metadata first. Back up the private media directory with the database. See ASSET_INVENTORY.md. Nearby distances require a stated straight-line or road-route method; commute times are not inferred.

## Routine operations

- Review new enquiries and requested visits; follow up through confirmed channels.
- Keep current inventory changes reasoned and audited; review conflicts promptly.
- Reconcile the 32 flagged cases and all other identities before publication.
- Review source document permissions and update revision/date information.
- Maintain encrypted backups, test restores, restrict staff roles and revoke departed staff.
- Set privacy contact, retention and deletion/anonymisation rules before public launch.
- Run lint/tests/build/E2E on each release. See DEPLOYMENT.md for exact commands.

No actual owner review, live delivery, legal validation, physical-device testing or public deployment is implied by the implementation tests.

### Proposed clubhouse facilities and 3D view

Pool and outdoor gym reference records are proposed concepts. In the Content workspace, **Stage owner-indicated amenities** adds only missing private draft records, without overwriting earlier owner edits. Review each record's position, scale, rotation, description, construction state and customer visibility; an authorised owner or administrator must review and publish it for connected public use. Never change a facility to existing merely because it is shown in the illustrative view. Pool, gym and clubhouse positions can be adjusted independently; review the whole layout for clipping and overlap before publishing. The 3D view uses the same published positions and plot IDs but schematic native 3D forms, not the supplied concept PNGs as 3D models.
