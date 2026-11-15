import { openDatabase, migrate } from "../server/db.mjs";
import { seed } from "../server/seed.mjs";
import { createUser } from "../server/auth.mjs";
import { loadSiteSource } from "../server/site-source.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
const fixture = "tests/fixtures/second-site/source.json";
const root = await mkdtemp(join(tmpdir(), "synthetic-site-b-"));
const build = join(root, "build");
const dbDir = join(root, "database");
const env = { ...process.env, NODE_ENV: "development", SITE_SOURCE_CONFIG: fixture, SITE_BUILD_DIR: build, LOCAL_DB_PATH: dbDir, DATABASE_URL: "", APP_ORIGIN: "http://127.0.0.1:5191", API_PORT: "3012", API_HOST: "127.0.0.1", DEMO_MODE: "true", MEDIA_DIRECTORY: join(root, "media") };
delete env.SITE_NAME;
const result = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { env, stdio: "inherit" });
if (result.status !== 0) { await rm(root, { recursive: true, force: true }); process.exit(result.status || 1); }
const selected = await loadSiteSource(fixture);
const db = await openDatabase({ url: null, dir: dbDir });
try {
  await migrate(db);
  await seed(db, { source: selected.source });
  await createUser(db, { name: "Synthetic owner", email: "siteb@example.invalid", password: "Synthetic-test-only-927156!", role: "owner" });
} finally { await db.close(); }
const child = spawn(process.execPath, ["server/start.mjs"], { env, stdio: "inherit" });
let stopping = false;
async function finish(code) {
  if (stopping) return;
  stopping = true;
  if (child.exitCode === null) {
    await new Promise(resolve => { child.once("exit", resolve); child.kill(); });
  }
  await rm(root, { recursive: true, force: true });
  process.exit(code);
}
child.on("exit", code => { if (!stopping) void finish(code || 1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void finish(0));
