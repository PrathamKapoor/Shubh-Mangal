# Field alignment prerequisites

Status: proposed acceptance procedure, reviewed against the source on 2026-11-15.
No measured field alignment, independent residual report, cadastral certification,
or completed second-site workflow is claimed. Public release is not authorized.

## What the code establishes

`shared/geography.mjs` projects WGS84 geographic coordinates using the layout's
UTM zone, hemisphere, metre offsets and geographic bounds. Geographic arrays use
longitude then latitude; Google positions use `{lat, lng}`. Plan x increases east;
plan y increases south from `northingTop`. Projection round trips test arithmetic,
not the accuracy of source coordinates against physical boundaries.

The product is configured for one colony. `server/geometry.mjs` validates
revision input against the selected layout's projection region and extent; amenity validation in
`server/content.mjs`, owner reference locations, source files, seed records and
project content are site-specific. Portable projection helpers do not establish a
multi-site product or a fully working second-site import/publication flow.
Illustrative presentation offsets and schematic 3D are not survey corrections.

## Evidence required before measuring

- Obtain dated written rights to inspect the site, occupy control points, capture
  coordinates/photos, process the supplied plans and publish each intended asset.
  Record the rights holder, scope, expiry and restrictions privately. Rights are
  currently unknown; possession of a plan or an owner's reference choice is not
  evidence of permission to distribute it.
- Appoint the responsible surveyor and owner reviewer. Identify the authoritative
  plan revision, parcel identifiers, survey date and source hash. Resolve duplicate
  labels and ambiguous block membership before linking measured parcels to IDs.
- Record source and target CRS, datum, coordinate order, units, UTM zone/hemisphere,
  any datum transformation and its parameters. Record instrument, correction
  service, observation dates, estimated accuracy and any vertical datum separately.
  Do not treat phone location or a satellite image as boundary control.
- Confirm physical access with the landholder: road approach, checkpoint/access
  restrictions, safe observation locations and the intended public entrance.
  Identify both gateposts by stable point IDs; measure them independently and
  distinguish a proposed gate illustration from an existing surveyed entrance.
  A navigation destination does not establish a legal right of access.

## Proposed measurement and acceptance record

1. Preserve the original source and current database/media backup before any
   revision. Give the candidate revision a new immutable ID and retain the old
   plot-to-geometry mapping and publication state.
2. Agree the transformation model and required control geometry with the surveyor.
   Collect distributed, stable controls around the perimeter and interior where
   accessible. Record point IDs, coordinates, observations and uncertainty. Do not
   choose controls solely to make a rendering look aligned.
3. Reserve distributed independent checkpoints that are never used to fit, tune,
   select or refit the transformation. Include the entrance/gateposts and relevant
   access junctions where accessible, plus checks away from the entrance. Record
   omissions and their effect on the acceptance area. The surveyor must set the
   required control/checkpoint counts and tolerances before fitting; no accepted
   counts or numeric tolerances have been supplied for this site.
4. Calculate each independent horizontal residual in the target metric CRS:
   `e_i = sqrt(deltaE_i^2 + deltaN_i^2)`. Report checkpoint count, each residual,
   `maximum = max(e_i)` and `RMS = sqrt(sum(e_i^2) / n)` in metres, alongside
   instrument uncertainty. Fit residuals must be reported separately. A small fit
   residual or projection round-trip error cannot substitute for holdout results.
5. Compare both maximum and RMS with the predeclared tolerances. Record observed
   values, dated surveyor/owner sign-off, rejected points and reasons. An empty
   checkpoint set is a failed/incomplete evaluation, never a zero-error result.
   Check topology, parcel evidence, gatepost separation, road access and source
   identity independently; a good visual overlay is insufficient.
6. Stage the candidate through the existing review process. Clear or re-review
   geometry-dependent claims, dimensions and price visibility as appropriate.
   Verify the public projection contains only approved published records. Obtain
   separate rights and public-release authorization before any publication.

## Rollback and unresolved work

Keep the prior source revision, mappings, measured record, database snapshot and
media snapshot. Record the operator, cutover time, release ID and rollback trigger.
If validation fails, leave the candidate unpublished. If a deployed revision must
be withdrawn, stop publication and follow the existing audited revision/recovery
procedure; do not delete history or silently move parcel boundaries. Restore into
a separate database when necessary and reconcile later writes before switching.

There is no implemented control-network collector, transformation-fitting tool,
independent-checkpoint residual calculator, automatic field acceptance gate or
end-to-end second-site configuration workflow in this procedure. These steps need
separate implementation or a retained survey deliverable. No measured maximum,
RMS, field acceptance, competitor parity or publication rights are established.
