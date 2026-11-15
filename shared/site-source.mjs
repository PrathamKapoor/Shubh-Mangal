// A source bundle is explicit and independent of the public identity payload.
// Asset URLs are references only; the caller must deploy and wire those assets.
const legacy = {
  name: "Shubh Mangal Residency",
  layoutFile: "public/data/layout.json",
  assets: {
    schematic: "/assets/geographic-layout.svg",
    surveyPlan: "/assets/survey-plan-north.png",
    poster: "/assets/colony-poster.png",
    surveyPdf: "/downloads/survey-plan-north.pdf",
    kml: "/downloads/Shubh_Mangal_Full_Layout.kml",
  },
  provenance: {
    source: "Supplied KML; divider reconstruction",
    projection: "UTM 43N",
    pdf: "MAHENDRAR JI ALL PDF NORTH.pdf",
    authority: "Supplied PDF after individual owner review",
  },
  amenities: [
    "Road network",
    "Water supply",
    "Electricity",
    "Security",
    "Landscaping",
    "Temple",
  ],
};
const text = (value) => typeof value === "string" && value.trim().length > 0;
const filePath = (value) =>
  typeof value === "string" &&
  /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(value) &&
  value.split("/").every((part) => part !== "." && part !== "..");
const assetKeys = ["schematic", "surveyPlan", "poster", "surveyPdf", "kml"];

export function createSiteSource(config = legacy) {
  if (
    !text(config?.name) ||
    !filePath(config.layoutFile) ||
    !config.assets ||
    !config.provenance ||
    !Array.isArray(config.amenities) ||
    !config.amenities.every(text)
  )
    throw new TypeError("Invalid site source configuration");
  const assets = {};
  for (const key of assetKeys) {
    const value = config.assets[key];
    if (
      value !== null &&
      !(
        typeof value === "string" &&
        value.startsWith("/") &&
        filePath(value.slice(1))
      )
    )
      throw new TypeError(`Invalid source asset: ${key}`);
    assets[key] = value;
  }
  const { source, projection, pdf, authority } = config.provenance;
  if (
    !text(source) ||
    !text(projection) ||
    (pdf !== null && !text(pdf)) ||
    !text(authority)
  )
    throw new TypeError("Invalid source provenance");
  return Object.freeze({
    name: config.name.trim(),
    layoutFile: config.layoutFile,
    assets: Object.freeze(assets),
    provenance: Object.freeze({ source, projection, pdf, authority }),
    amenities: Object.freeze([...config.amenities]),
  });
}
