import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createDiagnostics, observePostgres, reportFailures } from "./helpers/postgres-diagnostics.mjs";

test("PostgreSQL diagnostics redact secrets while retaining error code, stack and phase", () => {
  const lines = [];
  const d = createDiagnostics("shubh_test_synthetic", { secrets: ["private-password"], write: (line) => lines.push(JSON.parse(line)) });
  d.phase("setup");
  const error = Object.assign(new Error("private-password postgresql://user:secret@localhost/test"), { code: "57P01" });
  d.error("control", error, { backend: 123 });
  const row = lines.at(-1);
  assert.equal(row.phase, "setup");
  assert.equal(row.database, "shubh_test_synthetic");
  assert.equal(row.code, "57P01");
  assert.equal(row.backend, 123);
  assert.match(row.stack, /postgres-diagnostics.test.mjs/);
  assert.doesNotMatch(JSON.stringify(lines), /private-password|user:secret/);
  assert.ok(Number.isFinite(Date.parse(row.timestamp)));
});

test("PostgreSQL observers classify idle and transaction errors without suppressing emitter failure", () => {
  class Pool extends EventEmitter {}
  const pg = { Pool };
  const lines = [];
  const d = createDiagnostics("shubh_test_synthetic", { write: (line) => lines.push(JSON.parse(line)) });
  const restore = observePostgres(pg, d);
  try {
    const pool = new pg.Pool();
    const client = new EventEmitter();
    client.connection = new EventEmitter();
    client.processID = 123;
    pool.emit("connect", client);
    pool.emit("acquire", client);
    client.connection.emit("readyForQuery", { status: "T" });
    client.connection.emit("errorMessage", Object.assign(new Error("transaction failure"), { code: "57P01" }));
    pool.emit("release", undefined, client);
    const error = Object.assign(new Error("idle failure"), { code: "57P01" });
    assert.throws(() => pool.emit("error", error, client), (actual) => actual === error);
    assert.ok(lines.some((row) => row.location === "checked-out-transaction" && row.backend === 123));
    assert.ok(lines.some((row) => row.location === "idle-pool" && row.backend === 123));
  } finally { restore(); }
  assert.equal(pg.Pool, Pool);
});

test("PostgreSQL failure reporting preserves the original body failure before cleanup", () => {
  const body = new Error("first body failure"), cleanup = new Error("later cleanup failure");
  assert.throws(() => reportFailures(body, cleanup, []), (error) => {
    assert.equal(error.cause, body);
    assert.deepEqual(error.errors, [body, cleanup]);
    return true;
  });
  assert.throws(() => reportFailures(body, undefined, []), (error) => error === body);
  assert.throws(() => reportFailures(undefined, undefined, [cleanup]), (error) => error === cleanup);
});
