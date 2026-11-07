import { openDatabase } from "./db.mjs";
import { createApp } from "./app.mjs";
import { isAbsolute } from "node:path";
import { readdir } from "node:fs/promises";
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
const port = Number(process.env.API_PORT || 3001);
const server = createApp(db, { serveStatic: production }).listen(
  port,
  process.env.API_HOST || "127.0.0.1",
  () => console.info(`Shubh Mangal API: http://127.0.0.1:${port} (${db.kind})`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      process.exit(0);
    }),
  );
