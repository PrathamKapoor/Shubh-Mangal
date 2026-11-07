import { randomUUID } from "node:crypto";
import { approvedDataSchema, plotEditSchema, can } from "../shared/domain.mjs";
import { audit } from "./auth.mjs";
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function requirePermission(user, action) {
  if (!user) throw new HttpError(401, "Sign in first");
  if (!can(user.role, action))
    throw new HttpError(403, "Your role does not permit this action");
}
export async function getPlot(tx, id) {
  return (
    await tx.query(
      "SELECT p.*,g.draft_id,g.revision_id,d.data AS geometry,h.status_updated_at FROM plots p JOIN plot_geometry g ON g.plot_id=p.id JOIN draft_cells d ON d.id=g.draft_id LEFT JOIN (SELECT plot_id,max(created_at) AS status_updated_at FROM inventory_status_history GROUP BY plot_id) h ON h.plot_id=p.id WHERE p.id=$1",
      [id],
    )
  ).rows[0];
}
export function publicPlot(p) {
  return {
    ...p.geometry,
    id: p.id,
    geometryId: p.draft_id,
    label: p.number,
    block: p.block,
    status: p.status,
    publication: p.publication,
    version: p.version,
    approved: { ...p.data, reviewNote: undefined },
    verifiedAt: p.verified_at,
    updatedAt: p.updated_at,
    statusUpdatedAt: p.status_updated_at || null,
    sourceRevision: p.revision_id,
    identityReviewRequired: false,
    sourceIdentityReviewRequired: p.geometry.identityReviewRequired,
    sourceReviewRequired: true,
    priceINR: p.price_visible ? Number(p.price_inr) : null,
    reviewRequired: false,
  };
}
async function recordDimensions(tx, user, id, data) {
  await tx.query("DELETE FROM plot_dimensions WHERE plot_id=$1", [id]);
  for (const d of data.dimensions)
    await tx.query(
      "INSERT INTO plot_dimensions(id,plot_id,name,metres,source_text,edge_index,source_revision,reviewer_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        id,
        d.name,
        d.metres,
        d.sourceText,
        d.edgeIndex ?? null,
        data.sourceRevision,
        user.id,
      ],
    );
  await tx.query(
    "INSERT INTO plot_verifications(id,plot_id,reviewer_id,evidence) VALUES($1,$2,$3,$4)",
    [randomUUID(), id, user.id, JSON.stringify(data)],
  );
}
export async function approveDraft(tx, user, draftId, input) {
  requirePermission(user, "review");
  const data = approvedDataSchema.parse(input);
  const draft = (
    await tx.query("SELECT * FROM draft_cells WHERE id=$1", [draftId])
  ).rows[0];
  if (!draft) throw new HttpError(404, "Unknown draft geometry");
  if (
    data.dimensions.some(
      (d) => d.edgeIndex != null && d.edgeIndex >= draft.data.edges.length,
    )
  )
    throw new HttpError(422, "Dimension edge index is outside this shape");
  const id = randomUUID();
  await tx.query(
    "INSERT INTO plots(id,number,block,data,publication) VALUES($1,$2,$3,$4,$5)",
    [id, data.number, data.block, JSON.stringify(data), "draft"],
  );
  await tx.query(
    "INSERT INTO plot_geometry(plot_id,draft_id,revision_id) VALUES($1,$2,$3)",
    [id, draftId, draft.revision_id],
  );
  await recordDimensions(tx, user, id, data);
  await audit(
    tx,
    user,
    "identity.create",
    id,
    null,
    { draftId, data },
    data.reviewNote,
  );
  return getPlot(tx, id);
}
export async function updatePlot(tx, user, id, input) {
  const change = plotEditSchema.parse(input);
  const old = await getPlot(tx, id);
  if (!old) throw new HttpError(404, "Plot not found");
  if (old.version !== change.expectedVersion)
    throw new HttpError(409, "This record changed. Reload it before editing.");
  if (change.data) requirePermission(user, "review");
  if (
    change.status !== undefined ||
    change.priceINR !== undefined ||
    change.priceVisible !== undefined
  )
    requirePermission(user, "inventory");
  if (change.publication !== undefined)
    requirePermission(
      user,
      change.publication === "reviewed" ? "review" : "publish",
    );
  if (
    !change.data &&
    change.status === undefined &&
    change.publication === undefined &&
    change.priceINR === undefined &&
    change.priceVisible === undefined
  )
    throw new HttpError(422, "No changes supplied");
  let publication = change.publication ?? old.publication;
  const data = change.data ?? old.data;
  if (change.data) {
    publication = "draft";
    if (
      data.dimensions.some(
        (d) => d.edgeIndex != null && d.edgeIndex >= old.geometry.edges.length,
      )
    )
      throw new HttpError(422, "Edge index is outside this shape");
  }
  if (change.publication === "published" && old.publication !== "reviewed")
    throw new HttpError(422, "An owner can publish only a reviewed record");
  if (change.status && change.status !== "unverified" && !old.verified_at)
    throw new HttpError(
      422,
      "Review the identity before setting inventory status",
    );
  const price = change.priceINR === undefined ? old.price_inr : change.priceINR,
    visible = change.priceVisible ?? old.price_visible;
  if (visible && price == null)
    throw new HttpError(422, "A visible price needs a verified price record");
  const result = await tx.query(
    "UPDATE plots SET number=$1,block=$2,data=$3,publication=$4,status=$5,price_inr=$6,price_visible=$7,version=version+1,verified_at=$8,verified_by=$9,updated_at=now() WHERE id=$10 AND version=$11 RETURNING id",
    [
      data.number,
      data.block,
      JSON.stringify(data),
      publication,
      change.status ?? old.status,
      price,
      visible,
      change.data
        ? null
        : publication === "reviewed"
          ? new Date()
          : old.verified_at,
      change.data
        ? null
        : publication === "reviewed"
          ? user.id
          : old.verified_by,
      id,
      change.expectedVersion,
    ],
  );
  if (!result.rows.length)
    throw new HttpError(409, "Conflicting update; reload the record");
  if (change.data) await recordDimensions(tx, user, id, data);
  if (change.status && change.status !== old.status)
    await tx.query(
      "INSERT INTO inventory_status_history(id,plot_id,old_status,new_status,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), id, old.status, change.status, user.id, change.reason],
    );
  if (change.priceINR !== undefined || change.priceVisible !== undefined)
    await tx.query(
      "INSERT INTO price_records(id,plot_id,amount,visible,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), id, price, visible, user.id, change.reason],
    );
  const fresh = await getPlot(tx, id);
  await audit(tx, user, "plot.update", id, old, fresh, change.reason);
  return fresh;
}
