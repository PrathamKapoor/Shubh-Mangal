// Native direct-script loading: https://developers.google.com/maps/documentation/javascript/load-maps-js-api
const mapsError = (code) =>
  Object.assign(new Error(`Google Maps: ${code}`), { code });
let callbackSerial = 0;
export function createGoogleMapsLoader({
  window: win = globalThis.window,
  document: doc = globalThis.document,
  timeoutMs = 20000,
} = {}) {
  let attempt, authError, loadedKey, previousAuth, authHandler;
  const clients = new Set();
  function restoreAuth() {
    if (clients.size || attempt) return;
    if (win.gm_authFailure === authHandler) {
      if (previousAuth === undefined) delete win.gm_authFailure;
      else win.gm_authFailure = previousAuth;
    }
    authHandler = undefined;
  }
  function installAuth() {
    if (authHandler) return;
    previousAuth = win.gm_authFailure;
    authHandler = () => {
      authError = mapsError("auth");
      attempt?.finish(authError);
      for (const client of [...clients]) client.onAuthFailure?.(authError);
      previousAuth?.();
    };
    win.gm_authFailure = authHandler;
  }
  return function load({ key, signal, onAuthFailure } = {}) {
    if (!key?.trim()) return Promise.reject(mapsError("key"));
    if (authError) return Promise.reject(authError);
    if (signal?.aborted)
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    if (loadedKey && loadedKey !== key)
      return Promise.reject(mapsError("reload"));
    loadedKey = key;
    installAuth();
    return new Promise((resolve, reject) => {
      const client = { onAuthFailure, resolve, reject };
      let settled = false;
      const release = () => {
        clients.delete(client);
        signal?.removeEventListener("abort", abort);
        restoreAuth();
      };
      const abort = () => {
        release();
        if (!settled) {
          settled = true;
          reject(new DOMException("Aborted", "AbortError"));
        }
        if (!clients.size)
          attempt?.finish(new DOMException("Aborted", "AbortError"));
        restoreAuth();
      };
      client.complete = (error, maps) => {
        if (settled) return;
        settled = true;
        if (error) {
          release();
          reject(error);
        } else {
          resolve(maps);
          // A signal owns the post-load auth subscription until unmount.
          if (!signal) release();
        }
      };
      clients.add(client);
      signal?.addEventListener("abort", abort, { once: true });
      if (win.google?.maps?.Map && win.google.maps.Data) {
        client.complete(null, win.google.maps);
        return;
      }
      if (attempt) return;
      const script = doc.createElement("script");
      const callback = `__shubhGoogleMaps${++callbackSerial}`;
      let timer;
      const current = {
        finish(error) {
          if (attempt !== current) return;
          clearTimeout(timer);
          delete win[callback];
          script.onerror = null;
          attempt = undefined;
          if (error) script.remove();
          for (const entry of [...clients])
            entry.complete(error, win.google?.maps);
          restoreAuth();
        },
      };
      attempt = current;
      win[callback] = () =>
        current.finish(
          win.google?.maps?.Map && win.google.maps.Data
            ? null
            : mapsError("network"),
        );
      script.async = true;
      script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, loading: "async", callback, v: "weekly" })}`;
      script.nonce = doc.querySelector("script[nonce]")?.nonce || "";
      script.onerror = () => current.finish(mapsError("network"));
      timer = setTimeout(() => current.finish(mapsError("timeout")), timeoutMs);
      try {
        doc.head.append(script);
      } catch {
        current.finish(mapsError("network"));
      }
    });
  };
}
let nativeLoader;
export function loadGoogleMaps(options) {
  nativeLoader ??= createGoogleMapsLoader();
  return nativeLoader(options);
}

export function siteBounds(data) {
  const bounds = data?.geographicBounds;
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite)
  )
    return null;
  const [west, south, east, north] = bounds;
  return west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west < east &&
    south < north
    ? { west, south, east, north }
    : null;
}
function validGeometry(geometry) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type))
    return false;
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return (
    Array.isArray(polygons) &&
    polygons.length > 0 &&
    polygons.every(
      (polygon) =>
        Array.isArray(polygon) &&
        polygon.length > 0 &&
        polygon.every(
          (ring) =>
            Array.isArray(ring) &&
            ring.length >= 4 &&
            ring.every(
              (point) =>
                Array.isArray(point) &&
                point.length >= 2 &&
                Number.isFinite(point[0]) &&
                Number.isFinite(point[1]) &&
                Math.abs(point[0]) <= 180 &&
                Math.abs(point[1]) <= 90,
            ) &&
            ring[0][0] === ring.at(-1)[0] &&
            ring[0][1] === ring.at(-1)[1],
        ),
    )
  );
}
function counts(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) || 0) + 1);
  return result;
}
// Legacy mappings are deliberately ignored: they are not published geographic geometry.
export function buildMapFeatures(
  collection,
  plots = [],
  data,
  pathToGeographicGeometry,
) {
  if (
    collection?.type !== "FeatureCollection" ||
    !Array.isArray(collection.features)
  )
    throw mapsError("geometry");
  const ids = counts(collection.features.map((f) => f?.id));
  const plotIds = counts(collection.features.map((f) => f?.properties?.plotId));
  const inventoryIds = counts(plots.map((p) => p.id));
  const inventory = new Map(plots.map((p) => [p.id, p]));
  const approvedSources = new Set(
    plots.filter((p) => p.approved).map((p) => p.geometryId),
  );
  for (const feature of collection.features) {
    if (feature?.properties?.publication === "published")
      approvedSources.add(feature.properties.geometryId);
  }
  const features = [];
  for (const feature of collection.features) {
    const props = feature?.properties,
      plot = inventory.get(feature?.id);
    if (
      !plot?.approved ||
      inventoryIds.get(plot.id) !== 1 ||
      ids.get(feature.id) !== 1 ||
      plotIds.get(props?.plotId) !== 1 ||
      feature.type !== "Feature" ||
      props?.featureType !== "plot" ||
      props.publication !== "published" ||
      props.plotId !== plot.id ||
      !props.geometryId ||
      props.geometryId !== plot.geometryId ||
      !props.revisionId ||
      !Number.isInteger(props.version) ||
      props.version !== plot.version ||
      !validGeometry(feature.geometry)
    )
      continue;
    features.push({
      ...feature,
      properties: { ...props, provisional: false, status: plot.status },
    });
  }
  for (const plot of plots) {
    if (
      plot.approved ||
      inventoryIds.get(plot.id) !== 1 ||
      approvedSources.has(plot.id) ||
      ids.has(plot.id) ||
      !pathToGeographicGeometry
    )
      continue;
    const geometry = pathToGeographicGeometry(plot.path, data);
    if (validGeometry(geometry))
      features.push({
        type: "Feature",
        id: plot.id,
        properties: { plotId: plot.id, provisional: true, status: plot.status },
        geometry,
      });
  }
  return { type: "FeatureCollection", features };
}
