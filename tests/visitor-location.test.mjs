import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocationRequest,
  validatePosition,
  locationRelativeToBounds,
} from "../src/services/visitor-location.js";

const time = 1_800_000_000_000;
const fix = (coords = {}, timestamp = time) => ({
  coords: {
    latitude: 24.47,
    longitude: 74.91,
    accuracy: 12,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    ...coords,
  },
  timestamp,
});
const point = { lat: 24.47, lng: 74.91, accuracy: 12, timestamp: time };

// Only the browser boundary is faked: the controller and validation run for real.
function harness(t, overrides = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [],
    states = [];
  const geolocation = {
    getCurrentPosition(success, failure, options) {
      assert.equal(this, geolocation);
      calls.push({ success, failure, options });
    },
  };
  const controller = createLocationRequest({
    geolocation,
    secureContext: true,
    now: () => time,
    onChange: (state) => states.push(state),
    ...overrides,
  });
  t.after(() => controller.cancel());
  return { ...controller, calls, states };
}

test("construction is silent; explicit request makes exactly one browser call and sanitizes its fix", (t) => {
  const h = harness(t);
  assert.deepEqual(h.states, []);
  assert.equal(h.calls.length, 0);
  h.request();
  assert.deepEqual(h.states, [{ status: "requesting" }]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].options, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 12_000,
  });
  const raw = fix();
  h.calls[0].success(raw);
  assert.deepEqual(h.states.at(-1), { status: "success", position: point });
  raw.coords.latitude = 1;
  assert.equal(h.states.at(-1).position.lat, 24.47);
  t.mock.timers.tick(24_000);
  assert.equal(h.states.length, 2);
});

for (const [overrides, status] of [
  [{ secureContext: false }, "insecure"],
  [{ secureContext: undefined }, "insecure"],
  [{ geolocation: undefined }, "unsupported"],
  [{ geolocation: {} }, "unsupported"],
])
  test(`${status} reports a readable state without invoking geolocation`, (t) => {
    const h = harness(t, overrides);
    h.request();
    assert.equal(h.calls.length, 0);
    assert.equal(h.states.length, 1);
    assert.equal(h.states[0].status, status);
    assert.equal(typeof h.states[0].error, "string");
    assert.ok(h.states[0].error.length > 10);
    assert.equal(h.states[0].position, undefined);
    t.mock.timers.tick(24_000);
    assert.equal(h.states.length, 1);
  });

for (const [code, status] of [
  [1, "denied"],
  [2, "unavailable"],
  [3, "timeout"],
  [999, "unavailable"],
  ["1", "unavailable"],
  [undefined, "unavailable"],
]) {
  test(`browser error ${code} becomes sanitized ${status} and settles once`, (t) => {
    const h = harness(t);
    h.request();
    h.calls[0].failure({
      code,
      message: "SECRET raw browser message",
      extra: point,
    });
    assert.equal(h.states.at(-1).status, status);
    assert.equal(typeof h.states.at(-1).error, "string");
    assert.equal(h.states.at(-1).position, undefined);
    assert.equal(JSON.stringify(h.states).includes("SECRET"), false);
    h.calls[0].success(fix());
    h.calls[0].failure({ code: 1 });
    t.mock.timers.tick(24_000);
    assert.equal(h.states.length, 2);
  });
}

test("JavaScript deadline settles a stuck browser after 12 seconds, ignoring late callbacks", (t) => {
  const h = harness(t);
  h.request();
  t.mock.timers.tick(11_999);
  assert.equal(h.states.at(-1).status, "requesting");
  t.mock.timers.tick(1);
  assert.equal(h.states.at(-1).status, "timeout");
  h.calls[0].success(fix());
  h.calls[0].failure({ code: 1 });
  assert.equal(h.states.length, 2);
  h.request();
  h.calls[1].success(fix());
  assert.equal(h.states.at(-1).status, "success");
});

test("cancel is silent, repeatable, invalidates callbacks and allows a later explicit request", (t) => {
  const h = harness(t);
  h.request();
  h.cancel();
  h.cancel();
  h.calls[0].success(fix());
  h.calls[0].failure({ code: 1 });
  t.mock.timers.tick(24_000);
  assert.deepEqual(h.states, [{ status: "requesting" }]);
  h.request();
  h.calls[1].success(fix());
  assert.equal(h.states.at(-1).status, "success");
});

test("a new generation suppresses old success, error, and timeout without suppressing its own", (t) => {
  const h = harness(t);
  h.request();
  t.mock.timers.tick(6_000);
  h.request();
  h.calls[0].success(fix());
  h.calls[0].failure({ code: 1 });
  t.mock.timers.tick(6_000);
  assert.deepEqual(h.states, [
    { status: "requesting" },
    { status: "requesting" },
  ]);
  h.calls[1].success(fix());
  t.mock.timers.tick(12_000);
  assert.deepEqual(h.states.at(-1), { status: "success", position: point });
  assert.equal(h.states.length, 3);
});

test("a completed generation cannot overwrite a later request", (t) => {
  const h = harness(t);
  h.request();
  h.calls[0].success(fix());
  h.request();
  h.calls[0].success(fix({ latitude: 0 }));
  assert.deepEqual(h.states.at(-1), { status: "requesting" });
  h.calls[1].failure({ code: 1 });
  assert.equal(h.states.at(-1).status, "denied");
  assert.equal(h.states.at(-1).position, undefined);
});

test("synchronous browser exceptions are sanitized and clear the deadline", (t) => {
  const h = harness(t, {
    geolocation: {
      getCurrentPosition() {
        throw new Error("SECRET");
      },
    },
  });
  assert.doesNotThrow(() => h.request());
  assert.equal(h.states.at(-1).status, "unavailable");
  assert.equal(JSON.stringify(h.states).includes("SECRET"), false);
  t.mock.timers.tick(24_000);
  assert.equal(h.states.length, 2);
});

test("onChange can cancel during requesting without starting a browser operation", (t) => {
  let h;
  h = harness(t, { onChange: () => h.cancel() });
  h.request();
  assert.equal(h.calls.length, 0);
  t.mock.timers.tick(24_000);
});

test("onChange can request again while an earlier requesting notification runs", (t) => {
  let h,
    notifications = 0;
  h = harness(t, {
    onChange: () => {
      if (++notifications === 1) h.request();
    },
  });
  h.request();
  assert.equal(h.calls.length, 1);
  h.calls[0].success(fix());
  assert.equal(notifications, 3);
  t.mock.timers.tick(24_000);
  assert.equal(notifications, 3);
});

test("validation accepts finite coordinate limits and zero accuracy without coercion", () => {
  assert.deepEqual(validatePosition(fix(), time), {
    status: "success",
    position: point,
  });
  for (const latitude of [-90, 0, 90])
    for (const longitude of [-180, 0, 180]) {
      const result = validatePosition(
        fix({ latitude, longitude, accuracy: 0 }),
        time,
      );
      assert.equal(result.status, "success");
      assert.equal(result.position.accuracy, 0);
    }
});

for (const coords of [
  { latitude: NaN },
  { latitude: Infinity },
  { latitude: -90.001 },
  { latitude: 90.001 },
  { latitude: "24.47" },
  { latitude: null },
  { latitude: undefined },
  { longitude: -180.001 },
  { longitude: 180.001 },
  { longitude: -Infinity },
  { longitude: "74.91" },
  { longitude: null },
  { accuracy: -1 },
  { accuracy: NaN },
  { accuracy: Infinity },
  { accuracy: "12" },
  { accuracy: null },
  { accuracy: undefined },
])
  test(`rejects malformed measurement ${Object.keys(coords)[0]}=${String(Object.values(coords)[0])}`, () => {
    const result = validatePosition(fix(coords), time);
    assert.equal(result.status, "invalid");
    assert.equal(result.position, undefined);
    assert.equal(typeof result.error, "string");
  });

test("missing position, coords, timestamp or invalid clock never yields usable coordinates", () => {
  for (const raw of [
    null,
    undefined,
    {},
    { coords: null },
    { coords: fix().coords },
    fix({}, NaN),
    fix({}, Infinity),
    fix({}, "1800000000000"),
    fix({}, null),
    fix({}, -1),
  ]) {
    assert.equal(validatePosition(raw, time).status, "invalid");
    assert.equal(validatePosition(raw, time).position, undefined);
  }
  for (const clock of [NaN, Infinity, "1800000000000", null]) {
    assert.equal(validatePosition(fix(), clock).status, "invalid");
  }
});

test("freshness includes 60 seconds old and 5 seconds ahead, rejecting either side beyond policy", () => {
  for (const timestamp of [time - 60_000, time + 5_000]) {
    assert.equal(validatePosition(fix({}, timestamp), time).status, "success");
  }
  for (const timestamp of [time - 60_001, time + 5_001]) {
    const result = validatePosition(fix({}, timestamp), time);
    assert.equal(result.status, "stale");
    assert.equal(result.position, undefined);
    assert.equal(typeof result.error, "string");
  }
});

test("accuracy over 100 m is approximate and preserves valid sanitized measurement", (t) => {
  assert.equal(
    validatePosition(fix({ accuracy: 100 }), time).status,
    "success",
  );
  const h = harness(t);
  h.request();
  h.calls[0].success(fix({ accuracy: 100.01 }));
  const result = h.states.at(-1);
  assert.equal(result.status, "inaccurate");
  assert.deepEqual(result.position, { ...point, accuracy: 100.01 });
  assert.match(result.error, /approximate/i);
  assert.match(result.error, /accuracy/i);
});

test("callback validation uses the current clock and surfaces stale or invalid states", (t) => {
  let current = time;
  const h = harness(t, { now: () => current });
  h.request();
  current += 60_001;
  h.calls[0].success(fix());
  assert.equal(h.states.at(-1).status, "stale");
  h.request();
  h.calls[1].success(fix({ accuracy: -1 }, current));
  assert.equal(h.states.at(-1).status, "invalid");
  assert.equal(h.states.at(-1).position, undefined);
});

const bounds = { west: 74.9, south: 24.46, east: 74.92, north: 24.48 };
test("bounds helper classifies the reported point only, including edges and off-site approximate fixes", () => {
  assert.equal(locationRelativeToBounds(point, bounds), "within-bounds");
  assert.equal(
    locationRelativeToBounds({ ...point, lat: 24.46, lng: 74.9 }, bounds),
    "within-bounds",
  );
  assert.equal(
    locationRelativeToBounds({ ...point, lat: 24.48, lng: 74.92 }, bounds),
    "within-bounds",
  );
  for (const position of [
    { ...point, lat: 24.459 },
    { ...point, lat: 24.481 },
    { ...point, lng: 74.899 },
    { ...point, lng: 74.921, accuracy: 5000 },
  ]) {
    assert.equal(locationRelativeToBounds(position, bounds), "off-site");
  }
});

test("unsafe bounds or coordinates have unknown site relation", () => {
  for (const unsafe of [
    null,
    {},
    { ...bounds, west: 75 },
    { ...bounds, south: 25 },
    { ...bounds, north: NaN },
    { ...bounds, west: -181 },
    { ...bounds, north: 91 },
    { ...bounds, east: "74.92" },
    { ...bounds, west: bounds.east },
  ]) {
    assert.equal(locationRelativeToBounds(point, unsafe), "unknown");
  }
  for (const unsafe of [
    null,
    {},
    { lat: NaN, lng: 74.91 },
    { lat: 91, lng: 74.91 },
    { lat: 24.47, lng: 181 },
    { lat: "24.47", lng: 74.91 },
  ]) {
    assert.equal(locationRelativeToBounds(unsafe, bounds), "unknown");
  }
});
