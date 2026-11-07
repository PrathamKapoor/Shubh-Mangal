import React from "react";

// A cropped viewport removes transparent padding without altering the source
// image. Owner replacement images keep their own aspect ratio and full frame.
export default function AmenityArtwork({
  reference,
  href,
  originalUrl,
  scale = 1,
}) {
  const supplied = originalUrl === `/assets/concepts/${reference.image}`;
  // Existing owner records and replacement images retain the former framing.
  // Switching the bundled default never rewrites or unexpectedly enlarges them.
  const artwork =
    !supplied && reference.previousArtwork
      ? reference.previousArtwork
      : reference;
  const legacy = originalUrl === `/assets/concepts/${artwork.image}`;
  const [width, height] = artwork.mapSize.map((value) => value * scale);
  const frame = supplied || legacy ? artwork.mapCrop : [0, 0, width, height];
  const [imageWidth, imageHeight] =
    supplied || legacy ? artwork.imageSize : [width, height];
  return (
    <svg
      data-amenity-art-frame={reference.id}
      x={-width / 2}
      y={-height / 2}
      width={width}
      height={height}
      viewBox={frame.join(" ")}
      preserveAspectRatio="xMidYMid meet"
      overflow="hidden"
    >
      <image
        data-amenity-image={reference.id}
        href={href}
        x="0"
        y="0"
        width={imageWidth}
        height={imageHeight}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}
