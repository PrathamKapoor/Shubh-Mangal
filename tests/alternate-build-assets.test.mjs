import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { openDatabase, migrate } from "../server/db.mjs";
import { createApp } from "../server/app.mjs";

test("alternate production build contains only selected site source assets", { timeout: 90000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "shubh-alternate-build-"));
  try {
    const build = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
      env: { ...process.env, SITE_SOURCE_CONFIG: "tests/fixtures/second-site/source.json", SITE_BUILD_DIR: dir },
      encoding: "utf8", timeout: 80000,
    });
    assert.equal(build.status, 0, build.stderr);
    assert.match(await readFile(join(dir,"synthetic/schematic.svg"),"utf8"),/<svg/);
    for (const path of ["data/layout.json", "downloads/survey-plan-north.pdf", "downloads/Shubh_Mangal_Full_Layout.kml", "assets/colony-poster.png"])
      await assert.rejects(stat(join(dir,path)), {code:"ENOENT"}, path);
    assert.ok((await stat(join(dir,"downloads/inventory-review-template.csv"))).isFile());
    const db = await openDatabase({url:null,dir:":memory:"});
    try {
      await migrate(db);
      const app = createApp(db,{serveStatic:true,staticDirectory:dir,logging:false});
      for (const path of ["/data/layout.json", "/downloads/survey-plan-north.pdf", "/downloads/Shubh_Mangal_Full_Layout.kml", "/assets/colony-poster.png"]) {
        const response = await request(app).get(path);
        // The SPA fallback may return HTML; it must never return a legacy file.
        assert.ok(response.status === 404 || response.headers["content-type"]?.includes("text/html"), path);
      }
      const schematic = await request(app).get("/synthetic/schematic.svg");
      assert.equal(schematic.status, 200);
      assert.match(schematic.headers["content-type"], /image\/svg\+xml/);
    } finally { await db.close(); }
  } finally { await rm(dir,{recursive:true,force:true}); }
});
