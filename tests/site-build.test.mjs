import test from "node:test";
import assert from "node:assert/strict";
import { loadSiteSource } from "../server/site-source.mjs";
import { buildIdentity, assertBuildIdentity } from "../server/site-build.mjs";
test("site build identity binds source configuration and exact layout revision", async () => {
  const selected = await loadSiteSource("tests/fixtures/second-site/source.json");
  const manifest = buildIdentity(selected);
  assert.doesNotThrow(() => assertBuildIdentity(manifest, selected));
  assert.throws(() => assertBuildIdentity(manifest, { ...selected, revision: "other" }), /build.*match/i);
  assert.throws(() => assertBuildIdentity(manifest, { ...selected, source: { ...selected.source, name: "Another name" } }), /build.*match/i);
  assert.throws(() => assertBuildIdentity({}, selected), /build.*match/i);
});

test("normal startup rejects a mismatched build before opening the selected database", async () => {
  const { mkdtemp, mkdir, writeFile, access, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "synthetic-build-guard-"));
  const build = join(root, "build"), database = join(root, "database");
  try {
    await mkdir(build);
    await writeFile(join(build, "site-build.json"), JSON.stringify({ version: 1, digest: "wrong" }));
    const env = { ...process.env, NODE_ENV: "development", SITE_SOURCE_CONFIG: "tests/fixtures/second-site/source.json", SITE_BUILD_DIR: build, LOCAL_DB_PATH: database, DATABASE_URL: "" };
    delete env.SITE_NAME;
    const result = spawnSync(process.execPath, ["server/start.mjs"], { encoding: "utf8", env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /build does not match/i);
    await assert.rejects(access(database), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
