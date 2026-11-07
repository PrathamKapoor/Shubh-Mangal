import { referenceFor } from "../../shared/owner-amenity-references.mjs";

// The supplied 640px WebP copies are sufficient for map and card display.
// Owner replacement images retain their exact published URL.
export function preferredAmenityImage(amenity) {
  const reference = referenceFor(amenity.id);
  const filename = [reference?.image, reference?.previousArtwork?.image].find(
    (image) => image && amenity.imageUrl === `/assets/concepts/${image}`,
  );
  if (filename)
    return `/assets/concepts/${filename.replace(/\.png$/, "-map.webp")}`;
  return amenity.imageUrl;
}

// A generated cutout is presentation-only; the published source URL and owner
// record remain untouched. Custom images always keep their own framing.
export function foregroundReference(reference) {
  return reference?.foreground
    ? { ...reference, ...reference.foreground, previousArtwork: undefined }
    : null;
}
export function foregroundImage(reference, failedImages = new Set()) {
  const name = reference?.foreground?.image;
  if (!name) return null;
  const preferred = `/assets/concepts/${name.replace(/\.png$/, "-map.webp")}`;
  const original = `/assets/concepts/${name}`;
  return !failedImages.has(preferred)
    ? preferred
    : !failedImages.has(original)
      ? original
      : null;
}
