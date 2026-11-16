import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import pg from "pg";
import { openDatabase } from "../server/db.mjs";
import { validateDisposableTarget } from "../scripts/postgres-check.mjs";
import { createDiagnostics, observePostgres, reportFailures } from "./helpers/postgres-diagnostics.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("PostgreSQL adapter close waits for the real client disconnect before disposable database deletion", { skip: process.env.RUN_POSTGRES_SPATIAL_CHECK !== "true", timeout: 30000 }, async () => {
  const config = validateDisposableTarget(process.env);
  const name = `shubh_test_disconnect_${randomUUID().replaceAll("-", "")}`;
  assert.match(name, /^shubh_test_disconnect_[a-f0-9]{32}$/);
  const diagnostics = createDiagnostics(name, { secrets: [config.password] });
  const admin = new pg.Client(config);
  admin.on("error", (error) => diagnostics.error("control", error, { backend: admin.processID }));
  const restore = observePostgres(pg, diagnostics);
  const Observed = pg.Pool;
  const requested = deferred(), allowed = deferred();
  // Hold only the real wire-level Terminate, using a barrier rather than a
  // sleep. Queries and the production adapter continue to use real PostgreSQL.
  pg.Pool = class extends Observed {
    constructor(...args) {
      super(...args);
      this.on("connect", (client) => {
        const end = client.connection.end;
        client.connection.end = function () {
          diagnostics.record("terminate.requested", { backend: client.processID });
          requested.resolve();
          allowed.promise.then(() => { end.call(this); });
        };
      });
    }
  };
  let db, closing, created = false, bodyFailure, cleanupFailure;
  try {
    diagnostics.phase("setup");
    await admin.connect();
    diagnostics.record("control.connected", { backend: admin.processID });
    await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const url = new URL("postgresql://127.0.0.1");
    url.hostname = config.host === "::1" ? "[::1]" : config.host;
    url.port = String(config.port); url.username = config.user;
    url.password = config.password; url.pathname = `/${name}`;
    url.searchParams.set("sslmode", "disable");
    db = await openDatabase({ url: url.href });
    const backend = (await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    diagnostics.phase("close-with-termination-held");
    let finished = false;
    closing = db.close().then(() => { finished = true; diagnostics.record("adapter.close.resolved", { backend }); });
    await requested.promise;
    await setImmediate(); // Drain the event-loop turn, not a timing threshold.
    const sessions = (await admin.query("SELECT pid,state FROM pg_stat_activity WHERE datname=$1", [name])).rows;
    diagnostics.record("sessions", { sessions, adapterCloseResolved: finished });
    assert.ok(sessions.some((row) => row.pid === backend), "barrier must hold the real backend open");
    assert.equal(finished, false, "adapter.close resolved before its PostgreSQL client disconnected");
    allowed.resolve();
    await closing;
    const remaining = (await admin.query("SELECT pid FROM pg_stat_activity WHERE datname=$1", [name])).rows;
    diagnostics.record("sessions.after-disconnect", { sessions: remaining });
    assert.deepEqual(remaining, [], "completed adapter close must leave no database sessions");
    diagnostics.phase("assertions.complete");
  } catch (error) {
    bodyFailure = error;
    diagnostics.error("test-body", error);
  } finally {
    try {
      if (bodyFailure && created) {
        // Reproduce the original fixture's exact forced-drop ordering while
        // retaining the assertion above as the first failure.
        diagnostics.phase("cleanup.forced-drop-with-session-open");
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        created = false;
      }
      allowed.resolve();
      if (closing) await closing;
      else if (db) await db.close();
      if (created) {
        diagnostics.phase("cleanup.drop-after-disconnect");
        await admin.query(`DROP DATABASE "${name}"`);
      }
      await admin.end();
    } catch (error) {
      cleanupFailure = error;
      diagnostics.error("cleanup", error);
    } finally { allowed.resolve(); restore(); }
  }
  reportFailures(bodyFailure, cleanupFailure, diagnostics.failures);
});
