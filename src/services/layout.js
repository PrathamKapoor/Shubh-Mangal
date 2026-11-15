const legacyName = "Shubh Mangal Residency";
const unavailable = (status) => [404, 502, 503, 504].includes(status);

export function isLegacyReferenceMismatch(result, mode, siteName, bounds) {
  return Boolean(result && result.source !== "api" &&
    (mode === "connected" || (mode === "local-demo" &&
      (siteName !== legacyName || JSON.stringify(bounds) !== JSON.stringify(result.layout.geographicBounds)))));
}

async function validateLayout(layout) {
  const { projectionFromLayout } = await import("../../shared/geography.mjs");
  projectionFromLayout(layout);
  if (
    !Array.isArray(layout.viewBox) || layout.viewBox.length !== 4 ||
    !layout.viewBox.every(Number.isFinite) || layout.viewBox[2] <= 0 || layout.viewBox[3] <= 0 ||
    !Array.isArray(layout.plots) || !Array.isArray(layout.areas)
  ) throw Error("The selected layout is invalid.");
  return layout;
}

async function get(fetchImpl, url, signal) {
  try {
    return await fetchImpl(url, { signal });
  } catch (error) {
    if (signal?.aborted || error?.name === "AbortError") throw error;
    if (error instanceof TypeError) return null;
    throw error;
  }
}

// The server must return public-safe geometry. Client filtering cannot undo
// disclosure of drafts already sent in a public response.
export async function loadSelectedLayout({ signal, fetchImpl = fetch, allowOffline = false } = {}) {
  const selected = await get(fetchImpl, "/api/public/layout", signal);
  if (selected?.ok) return { layout: await validateLayout(await selected.json()), source: "api" };
  if (selected && !unavailable(selected.status)) throw Error("The selected layout is unavailable.");

  const project = await get(fetchImpl, "/api/public/project", signal);
  let source;
  let demoBounds;
  if (project?.ok) {
    const identity = await project.json();
    if (identity?.mode !== "local-demo" || identity.siteConfig?.name !== legacyName)
      throw Error("The selected layout is unavailable.");
    demoBounds = identity.geographicBounds;
    source = "demo-legacy";
  } else {
    if ((project && !unavailable(project.status)) || !allowOffline)
      throw Error("The selected layout is unavailable.");
    source = "offline-legacy";
  }
  const fallback = await get(fetchImpl, "/data/layout.json", signal);
  if (!fallback?.ok) throw Error("The legacy reference layout is unavailable.");
  const layout = await validateLayout(await fallback.json());
  if (layout.project !== legacyName) throw Error("The legacy reference layout does not match.");
  if (source === "demo-legacy" && JSON.stringify(demoBounds) !== JSON.stringify(layout.geographicBounds))
    throw Error("The legacy reference layout does not match the demo site.");
  return { layout, source };
}
