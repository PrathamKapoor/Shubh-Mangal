import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Test-only observers. Never serialize a pg client/config, query text or values.
export function createDiagnostics(database, { secrets = [], write } = {}) {
  const started = performance.now();
  let phase = "setup", sequence = 0;
  const failures = [];
  if (!write) {
    const directory = resolve(".local/ci-diagnostics");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = resolve(directory, `${database}-${process.pid}.jsonl`);
    write = (line) => { appendFileSync(file, line + "\n", { mode: 0o600 }); };
  }
  const redact = (value) => {
    let text = String(value).replace(/postgres(?:ql)?:\/\/[^\s)]+/gi, "[redacted connection]");
    for (const secret of secrets.filter(Boolean)) text = text.replaceAll(secret, "[redacted]");
    return text;
  };
  const record = (event, fields = {}) => {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), elapsedMs: +(performance.now() - started).toFixed(3), sequence: ++sequence, process: process.pid, database, phase, event, ...fields }, (_key, value) => typeof value === "string" ? redact(value) : value);
    write(line);
  };
  return {
    failures, record,
    phase: (name) => { phase = name; record("phase"); },
    error: (location, error, fields = {}) => {
      record("error", { location, code: error.code ?? null, name: error.name, message: error.message, stack: error.stack, ...fields });
      if (!failures.includes(error)) failures.push(error);
    },
  };
}

export function reportFailures(body, cleanup, connectionErrors) {
  const errors = [...new Set([body, cleanup, ...connectionErrors].filter(Boolean))];
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "PostgreSQL body, cleanup and connection failures (first failure preserved)", { cause: errors[0] });
}

export function observePostgres(pg, diagnostics) {
  const Original = pg.Pool;
  let poolCount = 0;
  pg.Pool = class ObservedPool extends Original {
    constructor(...args) {
      super(...args);
      const pool = ["setup", "first", "second"][poolCount++] ?? `pool-${poolCount}`;
      const clients = new WeakMap();
      let clientCount = 0;
      const emit = this.emit;
      this.emit = function (event, ...values) {
        const client = event === "error" || event === "release" ? values[1] : values[0];
        if (event === "connect") {
          const state = { connection: `${pool}-${++clientCount}`, backend: client.processID, state: "idle", transaction: false };
          clients.set(client, state);
          const clientEmit = client.emit;
          client.emit = function (name, ...args) {
            if (name === "error") diagnostics.error(state.state === "idle" ? "idle-client" : state.transaction ? "checked-out-transaction" : "checked-out-client", args[0], { pool, ...state });
            return clientEmit.call(this, name, ...args);
          };
          client.connection.on("readyForQuery", (message) => { state.transaction = message.status === "T" || message.status === "E"; });
          client.connection.on("errorMessage", (error) => diagnostics.error(state.state === "idle" ? "idle-client" : state.transaction ? "checked-out-transaction" : "checked-out-client", error, { pool, ...state }));
        }
        const state = client && clients.get(client);
        if (state && event === "acquire") state.state = "checked-out";
        if (state && event === "release") state.state = "idle";
        if (["connect", "acquire", "release", "remove"].includes(event)) diagnostics.record(`pool.${event}`, { pool, ...state, total: this.totalCount, idle: this.idleCount, waiting: this.waitingCount });
        if (event === "error") diagnostics.error("idle-pool", values[0], { pool, ...state });
        // Preserve EventEmitter semantics, including throwing unhandled errors.
        return emit.call(this, event, ...values);
      };
      const end = this.end;
      this.end = function (...args) {
        diagnostics.record("pool.end.start", { pool, total: this.totalCount, idle: this.idleCount });
        return end.apply(this, args);
      };
    }
  };
  return () => { pg.Pool = Original; };
}
