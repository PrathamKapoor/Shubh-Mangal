import React, { useEffect, useState } from "react";
import { can } from "../../shared/domain.mjs";
import { loadSelectedLayout } from "../services/layout";
import {
  presentationPlacementValid,
  presentationPlot,
} from "../../shared/presentation.mjs";

const blank = {
  source: "Owner-reviewed illustrative presentation",
  verifiedAt: null,
  placements: [],
};
const identity = (plot) => ({
  plotId: plot.id,
  geometryId: plot.draft_id,
  dx: 0,
  dy: 0,
  scale: 1,
  rotation: 0,
});

export default function PresentationEditor({
  item,
  plots,
  user,
  busy,
  run,
  mutate,
}) {
  const [draft, setDraft] = useState(() => item?.draft || blank);
  const [chosen, setChosen] = useState(plots[0]?.id || "");
  const [placement, setPlacement] = useState(null);
  const [reason, setReason] = useState("");
  const [sourceContext, setSourceContext] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    loadSelectedLayout({ signal: controller.signal })
      .then(({ layout }) => setSourceContext(layout))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const plot = plots.find((entry) => entry.id === chosen);
  useEffect(() => {
    if (!plot) return setPlacement(null);
    const current = draft.placements.find(
      (entry) => entry.plotId === plot.id && entry.geometryId === plot.draft_id,
    );
    setPlacement(current || identity(plot));
    // A new plot selection loads the saved local proposal; field edits stay local.
  }, [chosen]);
  const finite =
    placement &&
    [placement.dx, placement.dy, placement.scale, placement.rotation].every(
      Number.isFinite,
    );
  const withinLimits =
    finite &&
    Math.abs(placement.dx) <= 100 &&
    Math.abs(placement.dy) <= 100 &&
    placement.scale >= 0.5 &&
    placement.scale <= 2 &&
    Math.abs(placement.rotation) <= 180;
  const fits = Boolean(
    plot &&
    withinLimits &&
    presentationPlacementValid(plot.geometry, placement),
  );
  const inputPlot = plot && {
    ...plot.geometry,
    id: plot.id,
    geometryId: plot.draft_id,
  };
  const visual =
    inputPlot && withinLimits
      ? presentationPlot(inputPlot, placement)
      : inputPlot;
  const previewBounds = inputPlot &&
    visual && [
      Math.min(inputPlot.bounds[0], visual.bounds[0]) - 12,
      Math.min(inputPlot.bounds[1], visual.bounds[1]) - 12,
      Math.max(inputPlot.bounds[2], visual.bounds[2]) + 12,
      Math.max(inputPlot.bounds[3], visual.bounds[3]) + 12,
    ];
  const changed =
    JSON.stringify(draft) !== JSON.stringify(item?.draft || blank);
  function stagePlacement() {
    if (!fits) return;
    setDraft((previous) => ({
      ...previous,
      placements: [
        ...previous.placements.filter((entry) => entry.plotId !== plot.id),
        placement,
      ],
    }));
  }
  function save(publish) {
    if (reason.trim().length < 8 || draft.source.trim().length < 5) return;
    if (publish && (changed || !item || !draft.verifiedAt)) return;
    run(
      () =>
        mutate(
          "/admin/content/illustrated-layout",
          {
            kind: "presentation",
            data: draft,
            expectedVersion: item?.version || 0,
            publish,
            reason: reason.trim(),
          },
          "PUT",
        ),
      publish
        ? "Illustrated layout published."
        : "Illustrated layout draft saved.",
    );
  }
  return (
    <section className="presentation-editor">
      <h2>Illustrated layout review</h2>
      <p>
        Each visual shape starts with the plot's existing mapped geometry and
        immutable record ID. Position, rotation and uniform scale are
        presentation only; source dimensions and inventory never change. Shapes
        may move outside the source outline. Review the complete layout for
        neighbours, roads and overlaps before publishing.
      </p>
      <p className="small">
        Use Data review for plot identity and approved block membership. Use
        Content for amenity position, rotation and size. Saving here keeps the
        existing published layout until an owner or administrator publishes the
        reviewed draft.
      </p>
      {!plots.length ? (
        <p>
          No approved plot records exist yet. Review identities before creating
          visual placements.
        </p>
      ) : (
        <>
          <label>
            Plot record and source mapping
            <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {plots.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.block} · {entry.number} · {entry.publication} ·{" "}
                  {entry.id}
                </option>
              ))}
            </select>
          </label>
          {plot && placement && (
            <>
              <p className="small">
                Mapped source: <code>{plot.draft_id}</code>.{" "}
                {plot.publication !== "published" &&
                  "Publish the reviewed plot before publishing its visual placement."}
              </p>
              <div className="form-grid">
                {[
                  ["dx", "Horizontal offset", -100, 100, 0.05],
                  ["dy", "Vertical offset", -100, 100, 0.05],
                  ["scale", "Uniform visual scale", 0.5, 2, 0.01],
                  ["rotation", "Visual rotation (degrees)", -180, 180, 0.5],
                ].map(([key, title, min, max, step]) => (
                  <label key={key}>
                    {title}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      value={
                        Number.isFinite(placement[key]) ? placement[key] : ""
                      }
                      onChange={(event) =>
                        setPlacement({
                          ...placement,
                          [key]: event.target.valueAsNumber,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              {inputPlot && (
                <svg
                  className="presentation-preview"
                  role="img"
                  aria-label="Preview: original outline and proposed illustrative plot shape"
                  viewBox={`${previewBounds[0]} ${previewBounds[1]} ${previewBounds[2] - previewBounds[0]} ${previewBounds[3] - previewBounds[1]}`}
                >
                  {sourceContext?.areas
                    .filter((area) => area.kind === "road")
                    .map((area) => (
                      <path key={area.id} d={area.path} fill="#bac2bc" />
                    ))}
                  {sourceContext?.plots
                    .filter(
                      (cell) =>
                        cell.id !== plot.draft_id &&
                        cell.bounds[2] >= previewBounds[0] &&
                        cell.bounds[0] <= previewBounds[2] &&
                        cell.bounds[3] >= previewBounds[1] &&
                        cell.bounds[1] <= previewBounds[3],
                    )
                    .map((cell) => (
                      <path
                        key={cell.id}
                        d={cell.path}
                        fill="#f3f1e9"
                        stroke="#a5afa7"
                        strokeWidth=".12"
                      />
                    ))}
                  <path
                    d={inputPlot.path}
                    fill="#e6e4db"
                    stroke="#51645a"
                    strokeDasharray=".7 .5"
                    strokeWidth=".2"
                  />
                  <path
                    d={visual.path}
                    fill="#d4c496"
                    fillOpacity=".6"
                    stroke={fits ? "#9a6d1d" : "#a63d2c"}
                    strokeWidth=".3"
                  />
                </svg>
              )}
              <p className="small">
                Dashed outline: mapped source. Gold: proposed visual.
                Surrounding shapes show source context, not other staged
                changes.{" "}
                {fits
                  ? "Review its relationship to roads and neighbouring plots before publishing."
                  : "Enter valid presentation coordinates."}
              </p>
              <button
                type="button"
                disabled={!fits || busy}
                onClick={stagePlacement}
              >
                Add placement to draft
              </button>
            </>
          )}
        </>
      )}
      <ul className="presentation-placement-list">
        {draft.placements.map((entry) => {
          const record = plots.find(
            (candidate) => candidate.id === entry.plotId,
          );
          const stale = !record || record.draft_id !== entry.geometryId;
          return (
            <li key={entry.plotId}>
              <span>
                {record ? `${record.block} · ${record.number}` : entry.plotId} —{" "}
                {stale
                  ? "Mapping changed; remove and review again"
                  : "Source mapping retained"}
              </span>
              <button
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    placements: draft.placements.filter(
                      (other) => other.plotId !== entry.plotId,
                    ),
                  })
                }
              >
                Remove placement
              </button>
            </li>
          );
        })}
      </ul>
      <div className="form-grid">
        <label>
          Presentation source / review note
          <input
            value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
          />
        </label>
        <label>
          Reviewed at (ISO date/time, required to publish)
          <input
            value={draft.verifiedAt || ""}
            placeholder="YYYY-MM-DDT00:00:00Z"
            onChange={(e) =>
              setDraft({ ...draft, verifiedAt: e.target.value || null })
            }
          />
        </label>
        <label>
          Reason for change
          <input
            minLength={8}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={
            busy || reason.trim().length < 8 || draft.source.trim().length < 5
          }
          onClick={() => save(false)}
        >
          Save layout draft
        </button>
        {can(user.role, "publish") && (
          <button
            type="button"
            disabled={
              busy ||
              changed ||
              !item ||
              !draft.verifiedAt ||
              reason.trim().length < 8
            }
            onClick={() => save(true)}
          >
            Publish reviewed draft
          </button>
        )}
      </div>
      <p className="small">
        {item?.published
          ? "A reviewed presentation is published."
          : "No presentation adjustments are published; source-shaped plots are shown."}
      </p>
    </section>
  );
}
