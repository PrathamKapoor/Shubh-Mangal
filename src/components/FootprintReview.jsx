import React, { useEffect, useState } from "react";
import { geographicToPlan } from "../../shared/geography.mjs";
import { siteAccessFootprintSchema } from "../../shared/site-access.mjs";

const emptyFootprint = {
  datum: "WGS84",
  source: "",
  sourceRevision: "",
  outer: [],
  holes: [],
  interactions: [],
};
const pointText = (p) => (Array.isArray(p) ? p.join(", ") : "");
const parsePoint = (text) =>
  text.split(",").map((v) => (v.trim() === "" ? null : Number(v.trim())));

function RingEditor({ label, ring, onChange }) {
  const points =
    ring.length > 1 &&
    JSON.stringify(ring[0]) === JSON.stringify(ring[ring.length - 1])
      ? ring.slice(0, -1)
      : ring;
  function change(next) {
    onChange(next.length ? [...next, next[0]] : []);
  }
  return (
    <fieldset className="footprint-ring">
      <legend>{label}</legend>
      {points.map((point, index) => (
        <div className="footprint-point" key={index}>
          <label>
            {label} vertex {index + 1} (longitude, latitude)
            <Coordinate
              value={point}
              onChange={(v) =>
                change(points.map((p, i) => (i === index ? v : p)))
              }
            />
          </label>
          <button
            type="button"
            onClick={() => change(points.filter((_, i) => i !== index))}
          >
            Remove vertex {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={points.length >= 99}
        onClick={() => change([...points, [null, null]])}
      >
        Add vertex
      </button>
      <p className="small">
        The final vertex closes automatically. Enter at least three distinct
        vertices.
      </p>
    </fieldset>
  );
}
function Coordinate({ value, onChange }) {
  const [text, setText] = useState(() => pointText(value));
  useEffect(() => {
    setText(pointText(value));
  }, [value]);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(parsePoint(text))}
      placeholder="longitude, latitude"
    />
  );
}
function projected(point, layout) {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !point.every((n) => typeof n === "number" && Number.isFinite(n))
  )
    return null;
  try {
    return geographicToPlan({ lon: point[0], lat: point[1] }, layout);
  } catch {
    return null;
  }
}
function shapePath(shape, layout) {
  if (!shape || !Array.isArray(shape.outer) || !Array.isArray(shape.holes))
    return "";
  return [shape.outer, ...shape.holes]
    .map((ring) => {
      if (!Array.isArray(ring)) return "";
      const points = ring.map((p) => projected(p, layout));
      return points.length >= 3 && points.every(Boolean)
        ? `M ${points.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`
        : "";
    })
    .join(" ");
}
export default function FootprintReview({ item, busy, onStage }) {
  const [value, setValue] = useState(
    () => item.draft?.footprint || emptyFootprint,
  );
  const [importText, setImportText] = useState("");
  const [error, setError] = useState("");
  const [assessment, setAssessment] = useState(null);
  const [layout, setLayout] = useState(null);
  const [layoutError, setLayoutError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/layout.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then(setLayout)
      .catch((e) => {
        if (e.name !== "AbortError") setLayoutError(true);
      });
    return () => controller.abort();
  }, []);
  const update = (patch) => {
    setValue((v) => ({ ...v, ...patch }));
    setAssessment(null);
  };
  function importValue() {
    try {
      const parsed = siteAccessFootprintSchema.safeParse(
        JSON.parse(importText),
      );
      if (!parsed.success)
        throw Error(
          "JSON must match the WGS84 footprint format, including closed rings, source and interactions.",
        );
      update(parsed.data);
      setError("");
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "Footprint JSON could not be read. Check the syntax."
          : e.message,
      );
    }
  }
  async function stage(e) {
    const parsed = siteAccessFootprintSchema.safeParse(value);
    if (!parsed.success) {
      setError(
        "Complete the source, revision and WGS84 coordinates before staging. Rings need at least four coordinate pairs including closure.",
      );
      return;
    }
    const reason = e.currentTarget.form.elements.reason.value.trim();
    if (reason.length < 8) {
      setError("Enter a reason of at least 8 characters below before staging.");
      return;
    }
    setError("");
    const result = await onStage(parsed.data, reason);
    if (result) setAssessment(result.footprintAssessment || { warnings: [] });
  }
  const original = item.published?.footprint;
  const originalPath = layout ? shapePath(original, layout) : "";
  const proposedPath = layout ? shapePath(value, layout) : "";
  const projectedPoints = layout
    ? [original, value].flatMap((f) =>
        Array.isArray(f?.outer)
          ? f.outer.map((p) => projected(p, layout)).filter(Boolean)
          : [],
      )
    : [];
  const box = projectedPoints.length
    ? (() => {
        const xs = projectedPoints.map((p) => p.x),
          ys = projectedPoints.map((p) => p.y);
        const x = Math.min(...xs) - 25,
          y = Math.min(...ys) - 25;
        return [
          x,
          y,
          Math.max(50, Math.max(...xs) - x + 25),
          Math.max(50, Math.max(...ys) - y + 25),
        ];
      })()
    : layout?.viewBox;
  return (
    <section className="footprint-review" aria-label="Footprint review">
      <h3>Entrance footprint review</h3>
      <p>
        Provisional source layout and projected WGS84 coordinates; this is not a
        field survey or proof of clearance. Review crossings, structures and
        neighbouring parcels before publication.
      </p>
      <p className="small">
        Original: {original ? "published footprint" : "no published footprint"}{" "}
        · Proposed:{" "}
        {item.draft?.footprint ? "saved draft with local edits" : "local draft"}
        . Staging uses the saved access draft and leaves other unsaved edits
        here unchanged.
      </p>
      {layout && box && (
        <svg
          className="footprint-map"
          role="img"
          aria-label="Footprint preview"
          viewBox={box.join(" ")}
        >
          <title>
            Original and proposed footprints over provisional source layout
          </title>
          {layout.areas
            ?.filter((a) => a.kind !== "road")
            .map((a) => (
              <path key={a.id} d={a.path} className="footprint-area" />
            ))}
          {layout.areas
            ?.filter((a) => a.kind === "road")
            .map((a) => (
              <path
                key={a.id}
                d={a.path}
                className="footprint-area footprint-road"
              />
            ))}
          {layout.plots?.map((p) => (
            <path key={p.id} d={p.path} className="footprint-parcel" />
          ))}
          {originalPath && (
            <path
              d={originalPath}
              fillRule="evenodd"
              className="footprint-original"
            />
          )}
          {proposedPath && (
            <path
              d={proposedPath}
              fillRule="evenodd"
              className="footprint-proposed"
            />
          )}
          {value.interactions?.map((interaction, index) => {
            const points =
              interaction.type === "road"
                ? interaction.segment?.map((p) => projected(p, layout))
                : [projected(interaction.point, layout)];
            if (!points?.every(Boolean)) return null;
            return interaction.type === "road" && points.length === 2 ? (
              <line
                key={index}
                x1={points[0].x}
                y1={points[0].y}
                x2={points[1].x}
                y2={points[1].y}
                className="footprint-interaction"
              />
            ) : (
              <circle
                key={index}
                cx={points[0].x}
                cy={points[0].y}
                r="1.3"
                className="footprint-gate"
              />
            );
          })}
        </svg>
      )}
      {layoutError && (
        <p role="status">
          Source layout unavailable; coordinates can still be edited and staged.
        </p>
      )}
      <p className="footprint-legend">
        Dashed blue: published original · Solid red: proposed · Grey: source
        roads · Outlines: source parcels · Purple: declared road/gate
      </p>
      <label>
        Import footprint JSON
        <textarea
          rows={4}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
      </label>
      <button type="button" onClick={importValue}>
        Import footprint
      </button>
      <p className="small">
        Import a complete footprint object using WGS84 [longitude, latitude]
        pairs. Import replaces only this local proposal. Copy the current
        proposal below before reloading after a conflict.
      </p>
      <details>
        <summary>Copy current proposal JSON</summary>
        <label>
          Current proposal JSON
          <textarea readOnly rows={5} value={JSON.stringify(value, null, 2)} />
        </label>
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="form-grid">
        <label>
          Footprint evidence source
          <input
            value={value.source}
            onChange={(e) => update({ source: e.target.value })}
          />
        </label>
        <label>
          Footprint source revision
          <input
            value={value.sourceRevision}
            onChange={(e) => update({ sourceRevision: e.target.value })}
          />
        </label>
      </div>
      <RingEditor
        label="Outer boundary"
        ring={value.outer}
        onChange={(outer) => update({ outer })}
      />
      {value.holes.map((ring, index) => (
        <div key={index}>
          <RingEditor
            label={`Hole ${index + 1}`}
            ring={ring}
            onChange={(next) =>
              update({
                holes: value.holes.map((r, i) => (i === index ? next : r)),
              })
            }
          />
          <button
            type="button"
            onClick={() =>
              update({ holes: value.holes.filter((_, i) => i !== index) })
            }
          >
            Remove hole {index + 1}
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={value.holes.length >= 8}
        onClick={() => update({ holes: [...value.holes, []] })}
      >
        Add hole
      </button>
      <h4>Declared road and gate interactions</h4>
      {value.interactions.map((entry, index) => (
        <fieldset key={index}>
          <legend>
            {entry.type === "road" ? "Road" : "Gate"} {index + 1}
          </legend>
          <label>
            Interaction ID
            <input
              value={entry.id}
              onChange={(e) =>
                update({
                  interactions: value.interactions.map((v, i) =>
                    i === index ? { ...v, id: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          {entry.type === "gate" && (
            <label>
              Road ID
              <input
                value={entry.roadId}
                onChange={(e) =>
                  update({
                    interactions: value.interactions.map((v, i) =>
                      i === index ? { ...v, roadId: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
          )}
          {(entry.type === "road" ? entry.segment : [entry.point]).map(
            (p, pointIndex) => (
              <label key={pointIndex}>
                {entry.type === "road"
                  ? `Road endpoint ${pointIndex + 1}`
                  : "Gate point"}{" "}
                (longitude, latitude)
                <Coordinate
                  value={p}
                  onChange={(point) =>
                    update({
                      interactions: value.interactions.map((v, i) =>
                        i !== index
                          ? v
                          : entry.type === "road"
                            ? {
                                ...v,
                                segment: v.segment.map((old, j) =>
                                  j === pointIndex ? point : old,
                                ),
                              }
                            : { ...v, point },
                      ),
                    })
                  }
                />
              </label>
            ),
          )}
          <button
            type="button"
            onClick={() =>
              update({
                interactions: value.interactions.filter((_, i) => i !== index),
              })
            }
          >
            Remove {entry.type} {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={value.interactions.length >= 20}
        onClick={() =>
          update({
            interactions: [
              ...value.interactions,
              {
                type: "road",
                id: "",
                segment: [
                  [null, null],
                  [null, null],
                ],
              },
            ],
          })
        }
      >
        Add road
      </button>{" "}
      <button
        type="button"
        disabled={value.interactions.length >= 20}
        onClick={() =>
          update({
            interactions: [
              ...value.interactions,
              { type: "gate", id: "", roadId: "", point: [null, null] },
            ],
          })
        }
      >
        Add gate
      </button>
      <p>
        Stage separately on a saved visitor access record. The published record
        remains unchanged; save other access edits separately.
      </p>
      <button
        type="button"
        disabled={busy || item.id !== "visitor-entrance"}
        onClick={stage}
      >
        Stage footprint
      </button>
      {assessment && (
        <div role="status">
          <strong>Server assessment</strong>
          <p>
            {assessment.warnings?.length
              ? "Review warnings:"
              : "No server warnings returned."}
          </p>
          {assessment.warnings?.length > 0 && (
            <ul>
              {assessment.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
          <p>
            Review these warnings and surrounding features before publication.
            This assessment does not establish a surveyed location or prove clearance.
          </p>
        </div>
      )}
    </section>
  );
}
