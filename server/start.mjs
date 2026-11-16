import { openDatabase } from "./db.mjs";
import { createApp } from "./app.mjs";
import { isAbsolute, resolve } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { assertBuildIdentity, buildIdentity } from "./site-build.mjs";
import { loadSiteSource, assertSourceDatabase } from "./site-source.mjs";
import { createSiteSource } from "../shared/site-source.mjs";
const production = process.env.NODE_ENV === "production";
if (
  production &&
  (!process.env.APP_ORIGIN?.startsWith("https://") ||
    !["true", "false"].includes(process.env.DEMO_MODE) ||
    !process.env.MEDIA_DIRECTORY ||
    !isAbsolute(process.env.MEDIA_DIRECTORY))
)
  throw Error(
    "Set an HTTPS APP_ORIGIN, explicit DEMO_MODE and absolute MEDIA_DIRECTORY before production start",
  );
const selected = await loadSiteSource(process.env.SITE_SOURCE_CONFIG);
const staticDirectory = resolve(process.env.SITE_BUILD_DIR || "dist");
const alternate = JSON.stringify(selected.source) !== JSON.stringify(createSiteSource());
if (alternate) {
  if (process.env.SITE_NAME !== undefined && process.env.SITE_NAME !== selected.source.name)
    throw Error("SITE_NAME must match the selected source identity.");
}
if (production || alternate) {
  let manifest;
  try { manifest = JSON.parse(await readFile(resolve(staticDirectory, "site-build.json"), "utf8")); }
  catch { throw Error("Browser build identity is missing; build with the selected SITE_SOURCE_CONFIG."); }
  assertBuildIdentity(manifest, selected);
}
const db = await openDatabase();
try {
  const applied = new Set(
    (await db.query("SELECT version FROM schema_migrations")).rows.map(
      (row) => row.version,
    ),
  );
  const migrations = (
    await readdir(new URL("./migrations/", import.meta.url))
  ).filter((file) => file.endsWith(".sql"));
  if (migrations.some((file) => !applied.has(file)))
    throw Error("Pending migrations");
} catch {
  await db.close();
  throw Error(
    "Database has missing migrations. Back it up, stop the API and run npm run db:migrate; seed only when needed.",
  );
}
try {
  await assertSourceDatabase(db, selected);
} catch (error) {
  await db.close();
  throw error;
}
const port = Number(process.env.API_PORT || 3001);
const server = createApp(db, {
  serveStatic: production,
  sourceLayout: selected.layout,
  sourceAssets: selected.source.assets,
  sourceBundle: selected.source.layoutFile,
  sourceIdentity: buildIdentity(selected).digest,
  staticDirectory,
  ...(process.env.SITE_SOURCE_CONFIG !== undefined &&
  process.env.SITE_NAME === undefined
    ? { siteConfig: { name: selected.source.name } }
    : {}),
}).listen(port, process.env.API_HOST || "127.0.0.1", () =>
  console.info(`${selected.source.name} API: http://127.0.0.1:${port} (${db.kind})`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      process.exit(0);
    }),
  );
