// Identity for a single deployment. Passing a config is explicit: malformed
// alternate identities must never silently fall back to the legacy site.
const legacyName = "Shubh Mangal Residency";

export function createSiteConfig(config = { name: legacyName }) {
  if (typeof config?.name !== "string" || !config.name.trim())
    throw new TypeError("Site name must be a non-empty string");
  return Object.freeze({ name: config.name.trim() });
}

// Returns plain text; callers inserting it into HTML must escape it.
export function plotPageTitle(config, plot) {
  const { name } = createSiteConfig(config);
  return plot?.publication === "published"
    ? `Plot ${plot.number} · ${plot.block} · ${name}`
    : `Plot unavailable · ${name}`;
}
