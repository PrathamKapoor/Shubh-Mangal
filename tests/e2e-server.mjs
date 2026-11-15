import { openDatabase, migrate } from "../server/db.mjs";
import { seed } from "../server/seed.mjs";
import { createUser } from "../server/auth.mjs";
import { createApp } from "../server/app.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (
  process.env.E2E_TEST_MODE !== "true" ||
  process.env.NODE_ENV === "production"
)
  throw Error("This fixture server is only for isolated E2E tests");
const db = await openDatabase({ url: null, dir: ":memory:" });
const mediaDirectory = await mkdtemp(join(tmpdir(), "shubh-e2e-media-"));
await migrate(db);
await seed(db);
// Synthetic credentials exist only in this disposable in-memory test database.
await createUser(db, {
  name: "Test Owner",
  email: "owner@example.invalid",
  password: "Synthetic-test-only-927156!",
  role: "owner",
});
const server = createApp(db, {
  origin: "http://127.0.0.1:5181",
  logging: false,
  demo: true,
  mediaDirectory,
}).listen(3002, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      await rm(mediaDirectory, { recursive: true, force: true });
      process.exit(0);
    }),
  );
