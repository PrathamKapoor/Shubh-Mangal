import { openDatabase, migrate } from "../server/db.mjs";
import { seed } from "../server/seed.mjs";
import { createUser } from "../server/auth.mjs";
import { readFile, writeFile } from "node:fs/promises";
import { loadSiteSource } from "../server/site-source.mjs";
const db = await openDatabase();
try {
  const action = process.argv[2];
  if (action === "migrate") {
    await migrate(db);
    console.info("Migrations applied.");
  } else if (action === "seed") {
    const selected = await loadSiteSource(process.env.SITE_SOURCE_CONFIG);
    console.info(await seed(db, { source: selected.source }));
  } else if (action === "owner") {
    if (!process.env.OWNER_EMAIL || !process.env.OWNER_PASSWORD)
      throw Error(
        "Set OWNER_EMAIL and OWNER_PASSWORD in your private .env (password >=14 characters).",
      );
    console.info(
      "Created owner:",
      await createUser(db, {
        email: process.env.OWNER_EMAIL,
        name: process.env.OWNER_NAME || "Owner",
        password: process.env.OWNER_PASSWORD,
      }),
    );
  } else if (action === "verify") {
    console.info(
      "Plots:",
      (
        await db.query(
          "SELECT publication,count(*) FROM plots GROUP BY publication",
        )
      ).rows,
    );
    console.info(
      "History events:",
      (await db.query("SELECT count(*) FROM audit_logs")).rows[0],
    );
  } else if (action === "backup-local") {
    if (db.kind !== "local-pglite")
      throw Error("Use pg_dump for production PostgreSQL");
    // PGlite offers a complete physical data directory archive; close the app before backup.
    const archive = await db.dumpDataDir();
    await writeFile(
      process.argv[3] || ".local/backup.tar.gz",
      Buffer.from(await archive.arrayBuffer()),
      { mode: 0o600 },
    );
    console.info("Local backup written.");
  } else if (action === "restore-local") {
    if (!process.argv[3] || !process.argv[4])
      throw Error(
        "Usage: npm run db:restore -- backup.tar.gz NEW_EMPTY_DIRECTORY",
      );
    await db.close();
    const { PGlite } = await import("@electric-sql/pglite");
    const { access } = await import("node:fs/promises");
    try {
      await access(process.argv[4]);
      throw Error("Restore target must not exist");
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const p = new PGlite(process.argv[4], {
      loadDataDir: new Blob([await readFile(process.argv[3])]),
    });
    await p.waitReady;
    console.info(
      "Restored events:",
      (await p.query("SELECT count(*) FROM audit_logs")).rows[0],
    );
    await p.close();
    process.exit(0);
  } else throw Error("Unknown database command");
} finally {
  await db.close();
}
