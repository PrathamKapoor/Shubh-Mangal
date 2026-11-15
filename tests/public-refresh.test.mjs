import test from "node:test";
import assert from "node:assert/strict";
import { createPublicRefresh } from "../src/services/public-refresh.js";

const snapshot = (id) => ({ project: { items: [], mode: "connected", id }, plots: [], geometry: { type: "FeatureCollection", features: [] } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test("refresh commits one complete snapshot and ignores superseded responses", async () => {
  const first = deferred(), second = deferred(), committed = [], failed = [];
  let calls = 0;
  const refresh = createPublicRefresh({ load: () => (++calls === 1 ? first.promise : second.promise), onSnapshot: (value) => committed.push(value), onFailure: () => failed.push(true) });
  const old = refresh.refresh(), current = refresh.refresh();
  second.resolve(snapshot("new")); await current;
  first.resolve(snapshot("old")); await old;
  assert.deepEqual(committed.map((value) => value.project.id), ["new"]);
  assert.deepEqual(failed, []);
  refresh.dispose();
});

test("failure, invalid data and timeout report stale without committing partial data; later refresh recovers", async () => {
  const results = [Promise.reject(Error("offline")), Promise.resolve({ project: {}, plots: [], geometry: {} }), new Promise(() => {}), Promise.resolve(snapshot("recovered"))];
  const committed = [], failed = [];
  const refresh = createPublicRefresh({ load: () => results.shift(), timeoutMs: 15, onSnapshot: (value) => committed.push(value), onFailure: () => failed.push(true) });
  await refresh.refresh(); await refresh.refresh(); await refresh.refresh(); await refresh.refresh();
  assert.equal(failed.length, 3);
  assert.deepEqual(committed.map((value) => value.project.id), ["recovered"]);
  refresh.dispose();
});

test("dispose prevents pending requests from publishing state", async () => {
  const pending = deferred(), committed = [], failed = [];
  const refresh = createPublicRefresh({ load: () => pending.promise, onSnapshot: (value) => committed.push(value), onFailure: () => failed.push(true) });
  const request = refresh.refresh();
  refresh.dispose(); pending.resolve(snapshot("late")); await request;
  assert.deepEqual(committed, []); assert.deepEqual(failed, []);
});

test("superseded requests settle even when a loader ignores abort", async () => {
  const refresh = createPublicRefresh({ load: () => new Promise(() => {}), onSnapshot: () => assert.fail(), onFailure: () => assert.fail(), timeoutMs: 1000 });
  const first = refresh.refresh();
  const second = refresh.refresh();
  assert.equal(await Promise.race([first.then(() => "settled"), new Promise((resolve) => setTimeout(() => resolve("stalled"), 50))]), "settled");
  refresh.dispose();
  assert.equal(await Promise.race([second.then(() => "settled"), new Promise((resolve) => setTimeout(() => resolve("stalled"), 50))]), "settled");
});


test("an explicit revalidation state begins before each snapshot request completes", async () => {
  const pending=deferred(), events=[];
  const refresh=createPublicRefresh({load:()=>pending.promise,onStart:()=>events.push("checking"),onSnapshot:()=>events.push("ready"),onFailure:()=>events.push("failed")});
  const request=refresh.refresh();
  assert.deepEqual(events,["checking"]);
  pending.resolve(snapshot("next")); await request;
  assert.deepEqual(events,["checking","ready"]); refresh.dispose();
});
