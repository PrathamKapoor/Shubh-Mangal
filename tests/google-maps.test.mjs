import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMapFeatures,
  createGoogleMapsLoader,
  siteBounds,
} from "../src/services/google-maps.js";

const geometry = {
  type: "Polygon",
  coordinates: [
    [
      [74.9, 24.46],
      [74.91, 24.46],
      [74.91, 24.47],
      [74.9, 24.46],
    ],
  ],
};
const plot = {
  id: "uuid-a",
  geometryId: "cell-a",
  version: 2,
  approved: {},
  status: "available",
};
const feature = (properties = {}, id = plot.id) => ({
  type: "Feature",
  id,
  properties: {
    featureType: "plot",
    plotId: plot.id,
    geometryId: plot.geometryId,
    revisionId: "rev-a",
    version: 2,
    publication: "published",
    ...properties,
  },
  geometry,
});
const collection = (...features) => ({
  type: "FeatureCollection",
  features,
  mappings: [{ geometryId: "legacy" }],
});

test("only exact published inventory matches become official map features", () => {
  assert.equal(
    buildMapFeatures(collection(feature()), [plot]).features.length,
    1,
  );
  for (const properties of [
    { publication: "draft" },
    { version: 1 },
    { version: "2" },
    { geometryId: "other" },
    { plotId: "other" },
    { featureType: "road" },
    { revisionId: null },
  ]) {
    assert.equal(
      buildMapFeatures(collection(feature(properties)), [plot]).features.length,
      0,
    );
  }
  assert.equal(
    buildMapFeatures(collection(feature()), [{ ...plot, id: "unknown" }])
      .features.length,
    0,
  );
});
test("duplicate feature or inventory IDs suppress every ambiguous copy", () => {
  assert.equal(
    buildMapFeatures(collection(feature(), feature()), [plot]).features.length,
    0,
  );
  assert.equal(
    buildMapFeatures(collection(feature()), [plot, plot]).features.length,
    0,
  );
  assert.equal(
    buildMapFeatures(collection(feature(), feature({}, "other")), [plot])
      .features.length,
    0,
  );
});
test("provisional conversion receives unchanged raw paths and preserves holes; no approved fallback", () => {
  const holes = {
    ...geometry,
    coordinates: [...geometry.coordinates, geometry.coordinates[0]],
  };
  const raw = {
    id: "raw",
    path: "M raw path with holes",
    status: "unverified",
  };
  const data = { geographicBounds: [74.9, 24.46, 74.92, 24.48] };
  const result = buildMapFeatures(
    collection(feature({ version: 1 })),
    [plot, raw, { id: "cell-a", path: "draft" }],
    data,
    (path, actual) => {
      assert.equal(path, raw.path);
      assert.equal(actual, data);
      return holes;
    },
  );
  assert.equal(result.features.length, 1);
  assert.equal(result.features[0].properties.provisional, true);
  assert.equal(result.features[0].geometry, holes);
});
test("rejects malformed collections, geometry and unsafe site bounds", () => {
  assert.throws(() => buildMapFeatures({ mappings: [] }, [plot]));
  assert.equal(
    buildMapFeatures(
      collection({
        ...feature(),
        geometry: { type: "Point", coordinates: [0, 0] },
      }),
      [plot],
    ).features.length,
    0,
  );
  assert.deepEqual(
    siteBounds({ geographicBounds: [74.9, 24.46, 74.92, 24.48] }),
    { west: 74.9, south: 24.46, east: 74.92, north: 24.48 },
  );
  assert.equal(siteBounds({ geographicBounds: [1, 3, 0, 2] }), null);
});

function browser() {
  const scripts = [];
  const win = {};
  const doc = {
    querySelector: () => null,
    createElement: () => ({
      remove() {
        scripts.splice(scripts.indexOf(this), 1);
      },
    }),
    head: {
      append(s) {
        scripts.push(s);
      },
    },
  };
  return { win, doc, scripts };
}
test("loader is lazy, shares the official async callback script and cleans abort/auth handlers", async () => {
  const { win, doc, scripts } = browser();
  const previous = () => {};
  win.gm_authFailure = previous;
  const load = createGoogleMapsLoader({
    window: win,
    document: doc,
    timeoutMs: 100,
  });
  assert.equal(scripts.length, 0);
  const a = new AbortController(),
    b = new AbortController();
  const first = load({ key: "a & b", signal: a.signal });
  const second = load({ key: "a & b", signal: b.signal });
  assert.equal(scripts.length, 1);
  const url = new URL(scripts[0].src);
  assert.equal(url.origin, "https://maps.googleapis.com");
  assert.equal(url.searchParams.get("loading"), "async");
  assert.equal(url.searchParams.get("key"), "a & b");
  assert.equal(scripts[0].async, true);
  const callback = url.searchParams.get("callback");
  win.google = { maps: { Map: class {}, Data: class {} } };
  win[callback]();
  assert.equal(await first, win.google.maps);
  assert.equal(await second, win.google.maps);
  assert.equal(win[callback], undefined);
  a.abort();
  b.abort();
  assert.equal(win.gm_authFailure, previous);
});
test("loader rejects network/timeout failures and permits meaningful retry", async () => {
  for (const failure of ["network", "timeout"]) {
    const { win, doc, scripts } = browser();
    const load = createGoogleMapsLoader({
      window: win,
      document: doc,
      timeoutMs: 5,
    });
    const controller = new AbortController();
    const request = load({ key: "key", signal: controller.signal });
    const rejected = assert.rejects(request, (e) => e.code === failure);
    if (failure === "network") scripts[0].onerror();
    await rejected;
    assert.equal(scripts.length, 0);
    const retry = load({ key: "key", signal: controller.signal });
    const rejectRetry = assert.rejects(retry, (e) => e.name === "AbortError");
    controller.abort();
    await rejectRetry;
    assert.equal(scripts.length, 0);
  }
});
test("auth failure after callback is reported and requires reload even on retry", async () => {
  const { win, doc, scripts } = browser();
  const load = createGoogleMapsLoader({ window: win, document: doc });
  const controller = new AbortController();
  let reported;
  const request = load({
    key: "key",
    signal: controller.signal,
    onAuthFailure: (e) => {
      reported = e;
    },
  });
  win.google = { maps: { Map: class {}, Data: class {} } };
  win[new URL(scripts[0].src).searchParams.get("callback")]();
  await request;
  win.gm_authFailure();
  assert.equal(reported.code, "auth");
  await assert.rejects(load({ key: "key" }), (e) => e.code === "auth");
  controller.abort();
  assert.equal(win.gm_authFailure, undefined);
});
test("unmount during loading aborts and removes script, callback and auth handler", async () => {
  const { win, doc, scripts } = browser();
  const controller = new AbortController();
  const load = createGoogleMapsLoader({ window: win, document: doc });
  const request = load({ key: "key", signal: controller.signal });
  const callback = new URL(scripts[0].src).searchParams.get("callback");
  const rejected = assert.rejects(request, (e) => e.name === "AbortError");
  controller.abort();
  await rejected;
  assert.equal(scripts.length, 0);
  assert.equal(win[callback], undefined);
  assert.equal(win.gm_authFailure, undefined);
});

test("missing published inventory never exposes its raw source as a provisional substitute", () => {
  let conversions = 0;
  const result = buildMapFeatures(
    collection(feature()),
    [{ id: "cell-a", path: "draft" }],
    {},
    () => {
      conversions++;
      return geometry;
    },
  );
  assert.deepEqual(result.features, []);
  assert.equal(conversions, 0);
});
test("aborting one subscriber does not cancel another and pre-callback auth rejects", async () => {
  const { win, doc, scripts } = browser();
  const load = createGoogleMapsLoader({ window: win, document: doc });
  const a = new AbortController(),
    b = new AbortController();
  const one = load({ key: "key", signal: a.signal });
  const two = load({ key: "key", signal: b.signal });
  const rejectedOne = assert.rejects(one, (e) => e.name === "AbortError");
  a.abort();
  await rejectedOne;
  assert.equal(scripts.length, 1);
  const rejectedTwo = assert.rejects(two, (e) => e.code === "auth");
  win.gm_authFailure();
  await rejectedTwo;
  assert.equal(scripts.length, 0);
  b.abort();
  assert.equal(win.gm_authFailure, undefined);
});
