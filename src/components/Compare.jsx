import React from "react";
import { areaLabel, formatNumber, metres } from "../../shared/domain.mjs";
export default function Compare({
  plots,
  remove,
  select,
  units,
  areaUnit,
  loading = false,
  missing = [],
  loadError = "",
  onRetry,
}) {
  const rows = [
    ["Area", (p) => areaLabel(p, areaUnit)],
    [
      "Side lengths",
      (p) =>
        p.approved?.dimensions?.length
          ? p.approved.dimensions
              .map(
                (d) =>
                  `${d.name}: Verified ${formatNumber(metres(d.metres, units))} ${units}`,
              )
              .join("; ")
          : p.edges
              .map(
                (d, i) =>
                  `Edge ${i + 1}: Approx. ${formatNumber(metres(d.metres, units))} ${units}`,
              )
              .join("; "),
    ],
    [
      "Status",
      (p) =>
        p.status === "unverified" ? "Unverified" : `Verified ${p.status}`,
    ],
    ["Block", (p) => p.block],
    [
      "Road width",
      (p) =>
        p.approved?.roadWidthMetres
          ? `Verified ${formatNumber(metres(p.approved.roadWidthMetres, units))} ${units}`
          : "Not provided",
    ],
    ["Facing", (p) => p.approved?.facing || "Not provided"],
    ["Phase", (p) => p.approved?.phase || "Not provided"],
    [
      "Corner plot",
      (p) =>
        p.approved?.corner == null
          ? "Not provided"
          : `Verified ${p.approved.corner ? "Yes" : "No"}`,
    ],
    [
      "Park-facing",
      (p) =>
        p.approved?.parkFacing == null
          ? "Not provided"
          : `Verified ${p.approved.parkFacing ? "Yes" : "No"}`,
    ],
    [
      "Verification",
      (p) =>
        p.approved
          ? "Owner-reviewed identity; see field labels"
          : p.identityReviewRequired
            ? "Manual identity review required"
            : "All fields await owner review",
    ],
  ];
  return (
    <section className="compare-section">
      <span className="eyebrow">SIDE BY SIDE</span>
      <h1>Room to compare.</h1>
      <p>
        Compare up to three selections. Plan-reference comparisons are
        illustrative; missing information remains “Not provided”.
      </p>
      {!loading && !loadError && missing.length > 0 && (
        <div className="note" role="status">
          Some selections are not in the current data. They may be unpublished
          or temporarily unavailable.{" "}
          <button onClick={() => missing.forEach(remove)}>
            Remove unavailable selections
          </button>
        </div>
      )}
      {loadError ? (
        <div className="warning" role="alert">
          The comparison could not load the plot drawing.{" "}
          <button onClick={onRetry}>Retry comparison</button>
        </div>
      ) : loading ? (
        <p role="status">Loading comparison…</p>
      ) : plots.length ? (
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Selected plot comparison</caption>
            <thead>
              <tr>
                <th scope="col">Detail</th>
                {plots.map((p) => (
                  <th scope="col" key={p.id}>
                    <button
                      className="text-button"
                      onClick={() => select(p.id)}
                    >
                      {p.approved ? "Plot" : "Plan label"} {p.label} ↗
                    </button>
                    <button
                      aria-label={`Remove ${p.label} from comparison`}
                      onClick={() => remove(p.id)}
                    >
                      ×
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, get]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  {plots.map((p) => (
                    <td key={p.id}>{get(p)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="note">
          Choose “Compare” in plot details to add your first selection.{" "}
          <a href="/explore">Explore the plan →</a>
        </div>
      )}
    </section>
  );
}
