import React, { useEffect, useState } from "react";

// Map-native concept artwork. Dimensions are presentation units, never a
// statement of built facility dimensions. The containing area clips each item.
export default function LeisureFacility({ amenity, active, hindi }) {
  const pool = amenity.id === "owner-ref-pool";
  const name = pool ? "pool-concept" : "outdoor-gym-concept";
  const supplied = `/assets/concepts/${name}.png`;
  const imageUrl =
    !amenity.imageUrl || amenity.imageUrl === supplied
      ? `/assets/concepts/${name}-map.webp`
      : amenity.imageUrl;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    // SVG image errors are not reported consistently across browsers.
    const probe = new Image();
    probe.onerror = () => setFailed(true);
    probe.src = imageUrl;
    return () => {
      probe.onerror = null;
    };
  }, [imageUrl]);
  return (
    <g
      data-amenity={amenity.id}
      data-leisure-facility={pool ? "pool" : "gym"}
      className={`amenity-marker ${active ? "active" : ""}`}
      transform={`translate(${amenity.x} ${amenity.y}) rotate(${amenity.visualRotation || 0}) scale(${amenity.visualScale || 1})`}
    >
      <title>
        {hindi && amenity.titleHi ? amenity.titleHi : amenity.title} ·{" "}
        {amenity.state === "planned"
          ? "Proposed"
          : amenity.state === "confirmation_pending"
            ? "Status unverified"
            : (amenity.state || "Status unverified").replaceAll("_", " ")}{" "}
        · Illustrative concept
      </title>
      {!failed ? (
        <g transform={`translate(${pool ? 0.6 : 0} 0) rotate(90)`}>
          {active && (
            <rect
              x={pool ? -7.05 : -6}
              y={pool ? -4.7 : -4}
              width={pool ? 14.1 : 12}
              height={pool ? 9.4 : 8}
              rx=".5"
              fill="none"
              stroke="#b88927"
              strokeWidth=".5"
            />
          )}
          <image
            data-leisure-image={pool ? "pool" : "gym"}
            href={imageUrl}
            x={pool ? -7.05 : -6}
            y={pool ? -4.7 : -4}
            width={pool ? 14.1 : 12}
            height={pool ? 9.4 : 8}
            preserveAspectRatio="xMidYMid meet"
            onError={() => setFailed(true)}
          />
        </g>
      ) : pool ? (
        <g transform="rotate(-9)">
          <rect
            x="-4.6"
            y="-7.6"
            width="9.2"
            height="15.2"
            rx="1.2"
            fill="#eadfc0"
            stroke={active ? "#b88927" : "#b9a77f"}
            strokeWidth=".35"
          />
          <rect
            x="-3.25"
            y="-6.2"
            width="6.5"
            height="12.4"
            rx="1.15"
            fill="#258fa8"
            stroke="#f9f3dd"
            strokeWidth=".5"
          />
          <path
            d="M-2.5 -3.7 Q0 -4.3 2.5 -3.7 M-2.5 -.5 Q0 -1.1 2.5 -.5 M-2.5 2.7 Q0 2.1 2.5 2.7"
            fill="none"
            stroke="#bde8e7"
            strokeWidth=".2"
            opacity=".8"
          />
          <path
            d="M-3.5 -4.8 h-1 M-3.5 -3.8 h-1"
            fill="none"
            stroke="#fff"
            strokeWidth=".2"
          />
        </g>
      ) : (
        <g transform="rotate(-6)">
          <rect
            x="-4.1"
            y="-4.8"
            width="8.2"
            height="9.6"
            rx=".7"
            fill="#d5c9a7"
            stroke={active ? "#b88927" : "#a99972"}
            strokeWidth=".35"
          />
          <rect
            x="-3.6"
            y="-4.3"
            width="7.2"
            height="8.6"
            rx=".4"
            fill="#859582"
          />
          {/* Open-air fitness concept: two treadmills and weight stations. */}
          <g
            fill="#e9e6d8"
            stroke="#30483f"
            strokeWidth=".22"
            strokeLinejoin="round"
          >
            <rect x="-2.8" y="-3.5" width="1.8" height="3.1" rx=".25" />
            <rect x=".8" y="-3.5" width="1.8" height="3.1" rx=".25" />
            <path d="M-2.7 1 h2.5 v1.1 h-2.5z M.5 1 h2.4 v1.1 H.5z" />
          </g>
          <g
            fill="none"
            stroke="#293b35"
            strokeWidth=".38"
            strokeLinecap="round"
          >
            <path d="M-2.5 -2.7 h1.2 M1.1 -2.7 h1.2 M-2.8 3.2 h3 M-2.5 2.8 v.8 M-.1 2.8 v.8 M.7 3.2 h2.2 M.9 2.8 v.8 M2.7 2.8 v.8" />
          </g>
        </g>
      )}
    </g>
  );
}
