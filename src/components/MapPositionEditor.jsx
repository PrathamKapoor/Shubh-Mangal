import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  geographicToPlan,
  planToGeographic,
  projectionFromLayout,
} from "../../shared/geography.mjs";
import {
  amenityClipBridges,
  areaRing,
  referenceContains,
  referenceFor,
} from "../../shared/owner-amenity-references.mjs";
import AmenityArtwork from "./AmenityArtwork";
import LeisureFacility from "./LeisureFacility";
import { foregroundImage, foregroundReference } from "../services/amenities";
function projectLocation(location, layout) {
  try {
    return geographicToPlan(location, layout);
  } catch {
    return null;
  }
}
export default function MapPositionEditor({
  referenceId,
  location,
  onChange,
  imageUrl,
  visualScale = 1,
  visualRotation = 0,
}) {
  const [layout, setLayout] = useState(null),
    [error, setError] = useState(""),
    [wholeArea, setWholeArea] = useState(false),
    [focusLocation, setFocusLocation] = useState(location);
  const svg = useRef(null),
    reference = referenceFor(referenceId);
  const useForeground = Boolean(
    reference?.foreground && imageUrl === `/assets/concepts/${reference.image}`,
  );
  const artworkReference = useForeground
    ? foregroundReference(reference)
    : reference;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/layout.json", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw Error("Plan unavailable");
        return r.json();
      })
      .then((data) => {
        projectionFromLayout(data);
        setLayout(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError(
            "Plan could not be loaded. Enter coordinates above or retry.",
          );
      });
    return () => controller.abort();
  }, []);
  const viewBox = useMemo(() => {
    if (!layout) return null;
    if (!reference) return layout.viewBox;
    if (!wholeArea) {
      const focus =
        projectLocation(focusLocation, layout) ?? reference.mapPoint;
      let { x, y } = focus;
      const shared = ["owner-ref-temple", "owner-ref-garden"].includes(
        reference.id,
      );
      if (reference.id === "owner-ref-temple") {
        x += 4;
        y += 8.5;
      }
      if (reference.id === "owner-ref-garden") {
        x -= 1.5;
        y -= 7.5;
      }
      const width = Math.max(
        shared ? 42 : 40,
        artworkReference.mapSize[0] * 2.4,
      );
      const height = Math.max(
        shared ? 46 : 42,
        artworkReference.mapSize[1] * 2.5,
      );
      return [x - width / 2, y - height / 2, width, height];
    }
    const points = layout.areas
      .filter((a) => reference.areaIds.includes(a.id))
      .flatMap((a) => areaRing(a.path));
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]),
      x = Math.min(...xs),
      y = Math.min(...ys),
      w = Math.max(20, Math.max(...xs) - x),
      h = Math.max(20, Math.max(...ys) - y);
    return [x - w * 0.35, y - h * 0.35, w * 1.7, h * 1.7];
  }, [layout, reference, artworkReference, wholeArea, focusLocation]);
  if (!layout)
    return <p role={error ? "alert" : "status"}>{error || "Loading plan…"}</p>;
  const point = projectLocation(location, layout);
  const defaultImage = reference && `/assets/concepts/${reference.image}`;
  const previewImage = useForeground
    ? foregroundImage(reference)
    : reference && imageUrl === defaultImage
      ? `/assets/concepts/${reference.image.replace(/\.png$/, "-map.webp")}`
      : imageUrl?.replace("/api/public/media/", "/api/admin/media/");
  function setPoint(next) {
    if (reference && !referenceContains(layout, reference, next)) {
      setError("Choose a point inside the highlighted owner-indicated area.");
      return;
    }
    let lat, lon;
    try {
      ({ lat, lon } = planToGeographic(next, layout));
    } catch {
      setError("Choose a point within the colony region.");
      return;
    }
    if (lat < 24.46 || lat > 24.48 || lon < 74.9 || lon > 74.92) {
      setError("Choose a point within the colony region.");
      return;
    }
    setError("");
    onChange({ lat: Number(lat.toFixed(7)), lon: Number(lon.toFixed(7)) });
  }
  function click(e) {
    const p = svg.current.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const map = p.matrixTransform(svg.current.getScreenCTM().inverse());
    setPoint({ x: map.x, y: map.y });
  }
  function key(e) {
    if (!point) return;
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (directions[e.key]) {
      e.preventDefault();
      const [x, y] = directions[e.key];
      setPoint({ x: point.x + x, y: point.y + y });
    }
  }
  return (
    <div className="position-editor">
      <p>
        Choose a position on the plan. The highlighted area is an
        owner-indicated reference, not a survey. Arrow keys move the marker
        approximately one metre; coordinates can also be edited above. The
        artwork is clipped to this area, so check its fit when changing scale or
        rotation.
      </p>
      {useForeground &&
        ["owner-ref-temple", "owner-ref-garden"].includes(referenceId) && (
          <p className="small">
            This top-down foreground is used when the shared visual and both
            amenities are visible. The shared visual can also move, rotate or
            scale the composition; otherwise the individually published image is
            shown.
          </p>
        )}
      {reference?.mapNative && (
        <p className="small">
          The proposed facility is drawn as an illustrative concept; adjust its
          position, scale and rotation to review the fit.
        </p>
      )}
      {reference && (
        <button
          type="button"
          onClick={() => {
            if (wholeArea) setFocusLocation(location);
            setWholeArea((value) => !value);
          }}
        >
          {wholeArea ? "Focus current position" : "Show entire reference area"}
        </button>
      )}
      <svg
        ref={svg}
        viewBox={viewBox.join(" ")}
        onPointerDown={click}
        onKeyDown={key}
        tabIndex={0}
        role="img"
        aria-label="Choose the amenity position on the highlighted plan area"
      >
        {reference && (
          <defs>
            <clipPath
              id={`picker-clip-${referenceId}`}
              clipPathUnits="userSpaceOnUse"
            >
              {reference.areaIds.map((id) => {
                const area = layout.areas.find((item) => item.id === id);
                return area ? <path key={id} d={area.path} /> : null;
              })}
              {amenityClipBridges(layout, reference).map((path, index) => (
                <path key={index} d={path} />
              ))}
            </clipPath>
          </defs>
        )}
        {layout.areas.map((area) => (
          <path
            key={area.id}
            d={area.path}
            className={`picker-area picker-${area.kind} ${reference?.areaIds.includes(area.id) ? "picker-target" : ""}`}
          />
        ))}
        {point && reference && !reference.mapNative && previewImage && (
          <g clipPath={`url(#picker-clip-${referenceId})`} pointerEvents="none">
            <g
              transform={`translate(${point.x} ${point.y}) rotate(${visualRotation || 0})`}
            >
              <AmenityArtwork
                reference={artworkReference}
                href={previewImage}
                originalUrl={
                  useForeground
                    ? `/assets/concepts/${artworkReference.image}`
                    : imageUrl
                }
                scale={visualScale || 1}
              />
            </g>
          </g>
        )}
        {point && reference?.mapNative && (
          <g clipPath={`url(#picker-clip-${referenceId})`} pointerEvents="none">
            <LeisureFacility
              amenity={{
                ...reference,
                ...point,
                imageUrl: previewImage,
                visualScale,
                visualRotation,
              }}
            />
          </g>
        )}
        {layout.plots.map((plot) => (
          <path key={plot.id} d={plot.path} className="picker-plot" />
        ))}
        {point && (
          <circle
            cx={point.x}
            cy={point.y}
            r={Math.max(viewBox[2], viewBox[3]) * 0.015}
            className="picker-marker"
          />
        )}
      </svg>
      {reference && (
        <p className="small">
          Reference: {reference.locationNote}. Proposed placement requires owner
          review.
        </p>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
    </div>
  );
}
