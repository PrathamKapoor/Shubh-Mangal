import React, { useState } from "react";
import { preferredAmenityImage } from "../services/amenities";

export default function AmenityFigure({
  amenity,
  hindi = false,
  compact = false,
}) {
  const [failed, setFailed] = useState(() => new Set());
  if (!amenity.imageUrl) return null;
  const preferred = preferredAmenityImage(amenity);
  const source = !failed.has(preferred)
    ? preferred
    : !failed.has(amenity.imageUrl)
      ? amenity.imageUrl
      : null;
  const photo = amenity.imageKind === "photograph";
  const title = hindi && amenity.titleHi ? amenity.titleHi : amenity.title;
  const caption = hindi
    ? photo
      ? "स्वामी द्वारा दी गई तस्वीर"
      : "सांकेतिक चित्र"
    : photo
      ? "Owner-provided photo"
      : compact
        ? "Illustrative concept"
        : "Illustrative concept · not a photograph";
  return (
    <figure className={compact ? undefined : "amenity-image"}>
      {source ? (
        <img
          src={source}
          alt={`${title} — ${caption}`}
          loading="lazy"
          decoding="async"
          onError={() =>
            setFailed((previous) => new Set([...previous, source]))
          }
        />
      ) : (
        <p>
          {hindi
            ? "चित्र अभी उपलब्ध नहीं है।"
            : "Image temporarily unavailable."}
        </p>
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
