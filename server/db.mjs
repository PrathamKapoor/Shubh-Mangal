import { readFile, readdir, mkdir, open, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
export async function openDatabase({
  url = process.env.DATABASE_URL,
  dir = process.env.LOCAL_DB_PATH || ".local/database",
} = {}) {
  if (url) {
    const pool = new pg.Pool({
      connectionString: url,
      max: 10,
      ssl:
        process.env.PG_SSL === "true"
          ? { rejectUnauthorized: true }
          : undefined,
    });
    return {
      query: (s, p = []) => pool.query(s, p),
      exec: (s) => pool.query(s),
      close: () => pool.end(),
      kind: "postgres",
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const v = await fn({
            query: (s, p = []) => c.query(s, p),
            exec: (s) => c.query(s),
          });
          await c.query("COMMIT");
          return v;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
    };
  }
  if (process.env.NODE_ENV === "production")
    throw Error(
      "Production requires DATABASE_URL. PGlite is the explicit local substitute.",
    );
  let lock = null;
  const lockPath = resolve(dir) + ".lock";
  if (dir !== ":memory:") {
    await mkdir(resolve(dir), { recursive: true, mode: 0o700 });
    try {
      lock = await open(lockPath, "wx", 0o600);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let stale = false;
      try {
        const prior = JSON.parse(await readFile(lockPath, "utf8"));
        process.kill(prior.pid, 0);
      } catch (check) {
        if (check.code === "ESRCH") stale = true;
      }
      if (!stale)
        throw Error(
          "Local database is already open. Stop the local API before database commands.",
          { cause: e },
        );
      await rm(lockPath);
      lock = await open(lockPath, "wx", 0o600);
    }
    await lock.writeFile(JSON.stringify({ pid: process.pid }));
  }
  const db = new PGlite(dir === ":memory:" ? undefined : resolve(dir));
  try {
    await db.waitReady;
  } catch (e) {
    if (lock) {
      await lock.close();
      await rm(lockPath);
    }
    throw e;
  }
  let closed = false;
  return {
    query: (s, p = []) => db.query(s, p),
    exec: (s) => db.exec(s),
    dumpDataDir: () => db.dumpDataDir(),
    close: async () => {
      if (closed) return;
      closed = true;
      await db.close();
      if (lock) {
        await lock.close();
        await rm(lockPath, { force: true });
      }
    },
    kind: "local-pglite",
    transaction: (fn) => db.transaction(fn),
  };
}
export async function migrate(db) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const file of (await readdir(new URL("./migrations/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (
      (
        await db.query(
          "SELECT version FROM schema_migrations WHERE version=$1",
          [file],
        )
      ).rows.length
    )
      continue;
    const sql = await readFile(
      new URL(`./migrations/${file}`, import.meta.url),
      "utf8",
    );
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("INSERT INTO schema_migrations(version) VALUES ($1)", [
        file,
      ]);
    });
  }
}
